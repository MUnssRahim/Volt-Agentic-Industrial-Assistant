import os
import cv2
import time
import re
from collections import Counter
from typing import Annotated, TypedDict, Literal
from pydantic import BaseModel
from langgraph.graph.message import add_messages
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_pinecone import PineconeVectorStore
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.tools import DuckDuckGoSearchRun
from langgraph.graph import StateGraph, START, END
from ultralytics import YOLO
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

os.environ["GROQ_API_KEY"] = "GROQ-API-KEY-HERE"
os.environ["PINECONE_API_KEY"] = "PINECONE-API-KEY-HERE"

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    route_destination: str

class RouteDecision(BaseModel):
    route: Literal["normal", "industrial", "web_search", "vision"]

print("[LOG] Initializing LLMs, Vector Stores, and Vision Models...")

router_base = ChatGroq(model="openai/gpt-oss-120b", temperature=1)
router_llm = router_base.with_structured_output(RouteDecision)

llm = ChatGroq(model="openai/gpt-oss-120b", temperature=1)

embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vector_store = PineconeVectorStore(index_name="industrial", embedding=embeddings)
retriever = vector_store.as_retriever(search_kwargs={"k": 2})

web_search_tool = DuckDuckGoSearchRun()
yolo_model = YOLO("yolov8n.pt")
print("[LOG] All systems initialized.")

def router_node(state: AgentState):
    print("\n[LOG] --- ROUTER NODE STARTED ---")
    latest_message = state["messages"][-1].content
    print(f"[LOG] Analyzing user message: '{latest_message}'")
    
    system_prompt = SystemMessage(content="Analyze the user's message and determine the routing. Output 'industrial' if it relates to industrial materials, embedded systems, or computer vision. Output 'web_search' if it asks about current events or requires real-time information. Output 'vision' if the user asks you to look at something, use the camera, or identify objects they are holding. Output 'normal' for basic greetings, casual chat, or general questions.")
    
    decision = router_llm.invoke([system_prompt, HumanMessage(content=latest_message)])
    print(f"[LOG] Router classified intent. Decided path: {decision.route.upper()}")
    
    return {"route_destination": decision.route}

def vision_node(state: AgentState):
    print("\n[LOG] --- VISION NODE STARTED ---")
    print("[LOG] Activating webcam (index 0) and allowing hardware to adjust exposure...")
    
    cap = cv2.VideoCapture(0)
    time.sleep(1)
    
    for _ in range(4):
        cap.read()
        
    ret, frame = cap.read()
    cap.release()
    
    if not ret:
        print("[LOG] FATAL: Failed to capture image from webcam hardware.")
        system_prompt = SystemMessage(content="You are an AI assistant. The user asked you to look through the camera, but the camera hardware failed. Apologize and let them know the hardware is offline.")
    else:
        print("[LOG] Frame captured successfully. Pushing frame through Ultralytics YOLOv8...")
        results = yolo_model(frame, verbose=False)
        
        detected_objects = []
        for r in results:
            for box in r.boxes:
                conf = float(box.conf[0])
                if conf > 0.4:
                    cls_id = int(box.cls[0])
                    detected_objects.append(yolo_model.names[cls_id])
                    
        if detected_objects:
            counts = Counter(detected_objects)
            objects_str = ", ".join([f"{count} {obj}(s)" for obj, count in counts.items()])
            print(f"[LOG] YOLO detected: {objects_str}")
            system_prompt = SystemMessage(content=f"You accessed the camera and see: {objects_str}. Answer the user based ONLY on this list. Keep your response to a single, brief conversational sentence. Do not use markdown.")
        else:
            print("[LOG] YOLO execution finished. No recognizable objects found in frame.")
            system_prompt = SystemMessage(content="You accessed the camera, but YOLO could not identify any specific objects in the current frame. Inform the user you don't see anything notable in one brief sentence.")
            
    messages = [system_prompt] + state["messages"]
    
    print("[LOG] Generating final LLM response synthesizing visual data...")
    response = llm.invoke(messages)
    
    print("[LOG] Vision Node complete.")
    return {"messages": [response]}

def normal_node(state: AgentState):
    print("\n[LOG] --- NORMAL NODE STARTED ---")
    print("[LOG] Handling request directly via LLM without external tools.")
    
    system_prompt = SystemMessage(content="You are a friendly conversational AI assistant. Keep your response conversational and strictly between 2 to 3 sentences. Do not use bullet points, markdown, or bold text. Write exactly how you would speak it aloud. If you do not understand the query, politely apologize.")
    messages = [system_prompt] + state["messages"]
    
    print("[LOG] Generating standard LLM response...")
    response = llm.invoke(messages)
    
    print("[LOG] Normal Node complete.")
    return {"messages": [response]}

def industrial_node(state: AgentState):
    print("\n[LOG] --- INDUSTRIAL (RAG) NODE STARTED ---")
    latest_message = state["messages"][-1].content
    
    print(f"[LOG] Querying Pinecone Vector Database for: '{latest_message}'")
    docs = retriever.invoke(latest_message)
    context_str = "\n".join([doc.page_content for doc in docs])[:1200]
    print(f"[LOG] Retrieved and truncated document chunks from Pinecone to {len(context_str)} characters.")
    
    system_prompt = SystemMessage(content=f"You are a technical expert. Answer the question using this context:\n{context_str}\n\nCRITICAL INSTRUCTION: Your final output MUST be a conversational summary of about 80 to 100 words. Do NOT use bullet points, asterisks, or markdown of any kind. Speak naturally as if having a conversation.")
    messages = [system_prompt] + state["messages"]
    
    print("[LOG] Synthesizing final response with RAG context...")
    response = llm.invoke(messages)
    
    print("[LOG] Industrial Node complete.")
    return {"messages": [response]}

def web_search_node(state: AgentState):
    print("\n[LOG] --- WEB SEARCH NODE STARTED ---")
    latest_message = state["messages"][-1].content
    
    print(f"[LOG] Executing DuckDuckGo Web Search for: '{latest_message}'")
    search_results = str(web_search_tool.invoke(latest_message))[:1200]
    print("[LOG] Web Search successful. Truncated live internet data injected.")
    
    system_prompt = SystemMessage(content=f"Answer the user's question accurately using these search results:\n{search_results}\n\nCRITICAL INSTRUCTION: Keep your response conversational and summarize it in around 3 to 4 short sentences. Do not use lists, asterisks, or markdown formatting.")
    messages = [system_prompt] + state["messages"]
    
    print("[LOG] Generating LLM response grounded in web data...")
    response = llm.invoke(messages)
    
    print("[LOG] Web Search Node complete.")
    return {"messages": [response]}

def route_condition(state: AgentState):
    print(f"[LOG] --- EXECUTING CONDITIONAL EDGE -> Routing to Node: [{state['route_destination'].upper()}] ---")
    return state["route_destination"]

workflow = StateGraph(AgentState)

workflow.add_node("router", router_node)
workflow.add_node("normal", normal_node)
workflow.add_node("industrial", industrial_node)
workflow.add_node("web_search", web_search_node)
workflow.add_node("vision", vision_node)

workflow.add_edge(START, "router")

workflow.add_conditional_edges(
    "router",
    route_condition,
    {
        "normal": "normal",
        "industrial": "industrial",
        "web_search": "web_search",
        "vision": "vision"
    }
)

workflow.add_edge("normal", END)
workflow.add_edge("industrial", END)
workflow.add_edge("web_search", END)
workflow.add_edge("vision", END)

app = workflow.compile()
print("\n[LOG] MULTI-NODE SUPERVISOR GRAPH COMPILED SUCCESSFULLY!")

api = FastAPI()

api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str

@api.post("/chat")
def chat_endpoint(req: ChatRequest):
    print(f"\n[LOG] --- INCOMING HTTP REQUEST ---")
    print(f"[LOG] User message received from React UI: '{req.message}'")
    
    inputs = {"messages": [HumanMessage(content=req.message)]}
    result = app.invoke(inputs)
    raw_answer = result["messages"][-1].content
    
    clean_text = raw_answer.replace("*", "").replace("#", "").replace("_", "")
    clean_text = re.sub(r'```.*?```', '', clean_text, flags=re.DOTALL)
    clean_text = re.sub(r'`.*?`', '', clean_text)
    clean_text = re.sub(r'[^a-zA-Z0-9\s.,!?\'"-]', '', clean_text)
    clean_text = " ".join(clean_text.split())
    
    print(f"[LOG] Sanitized response ready for TTS: {clean_text}")
    return {"response": clean_text}

if __name__ == "__main__":
    print("\n[LOG] Starting local FastAPI server...")
    uvicorn.run(api, host="0.0.0.0", port=8000)
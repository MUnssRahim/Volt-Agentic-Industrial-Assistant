import os
import re

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

os.environ.setdefault("GROQ_API_KEY", "")
os.environ.setdefault("PINECONE_API_KEY", "")

from agent_graph import app

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
    print("\n[LOG] --- INCOMING HTTP REQUEST ---")
    print(f"[LOG] User message received from React UI: '{req.message}'")

    inputs = {"messages": [HumanMessage(content=req.message)]}
    result = app.invoke(inputs)
    raw_answer = result["messages"][-1].content

    clean_text = raw_answer.replace("*", "").replace("#", "").replace("_", "")
    clean_text = re.sub(r"```.*?```", "", clean_text, flags=re.DOTALL)
    clean_text = re.sub(r"`.*?`", "", clean_text)
    clean_text = re.sub(r"[^a-zA-Z0-9\s.,!?\'\"-]", "", clean_text)
    clean_text = " ".join(clean_text.split())

    print(f"[LOG] Sanitized response ready for TTS: {clean_text}")
    return {"response": clean_text}


if __name__ == "__main__":
    print("\n[LOG] Starting local FastAPI server...")
    uvicorn.run(api, host="0.0.0.0", port=8000)

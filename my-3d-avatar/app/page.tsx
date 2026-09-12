"use client";

import { useState, useEffect, useMemo } from "react";

type AgentState = "idle" | "listening" | "thinking" | "speaking";

const STATE_COPY: Record<AgentState, { label: string; hint: string }> = {
  idle: { label: "Idle", hint: "Press to speak" },
  listening: { label: "Listening", hint: "Go ahead, Volt is listening" },
  thinking: { label: "Thinking", hint: "Working on it" },
  speaking: { label: "Speaking", hint: "Volt is responding" },
};

const HAIR_ANGLES = [-150, -125, -100, -80, -60, -35, -10];
const SPARKLES = [
  { x: 28, y: 36, delay: 0 },
  { x: 208, y: 58, delay: 0.6 },
  { x: 196, y: 172, delay: 1.2 },
  { x: 20, y: 150, delay: 1.8 },
];

// Voice names commonly reported by browsers/OSes for female-sounding voices.
// Matching is best-effort since Web Speech doesn't expose a gender field.
const FEMALE_VOICE_HINTS = [
  "female", "samantha", "victoria", "zira", "susan", "karen", "moira",
  "tessa", "fiona", "kathy", "google uk english female", "google us english",
  "microsoft zira", "ava", "allison",
];

export default function VoiceAgent() {
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [transcript, setTranscript] = useState<{ from: "user" | "agent" | "system"; text: string; time: string }[]>([]);
  const [liveCaption, setLiveCaption] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      setMousePos({ x, y });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // voice list loads asynchronously in most browsers
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const pushLine = (from: "user" | "agent" | "system", text: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setTranscript((prev) => [...prev, { from, text, time }]);
  };

  const startListening = () => {
    if (agentState !== "idle") return;

    console.log("[LOG] Initializing Web Speech Recognition...");
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.log("[LOG] FATAL: Browser does not support Speech Recognition.");
      pushLine("system", "Voice input isn't supported here — try Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log("[LOG] Microphone active. Agent State -> LISTENING");
      setLiveCaption("");
      setAgentState("listening");
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += piece;
        } else {
          interim += piece;
        }
      }

      if (interim) {
        console.log(`[LOG] Interim transcript: '${interim}'`);
        setLiveCaption(interim);
      }

      if (final) {
        console.log(`[LOG] Voice captured: '${final}'`);
        setLiveCaption("");
        pushLine("user", final);
        sendToBackend(final);
      }
    };

    recognition.onerror = (event: any) => {
      console.log(`[LOG] Speech Recognition Error: ${event.error}`);
      setLiveCaption("");
      setAgentState("idle");
    };

    recognition.onend = () => {
      console.log("[LOG] Microphone deactivated.");
    };

    recognition.start();
  };

  const sendToBackend = async (userMsg: string) => {
    console.log(`[LOG] Sending text to local Python backend: ${userMsg}`);
    setAgentState("thinking");

    try {
      const response = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });

      const data = await response.json();
      console.log(`[LOG] Received response from Python:`, data.response);

      pushLine("agent", data.response);
      speakResponse(data.response);
    } catch (error) {
      console.error("[LOG] Connection to Python server failed:", error);
      pushLine("system", "Couldn't reach the backend at localhost:8000.");
      setAgentState("idle");
    }
  };

  const pickVoice = () => {
    if (!voices.length) return undefined;
    const hinted = voices.find((v) => FEMALE_VOICE_HINTS.some((hint) => v.name.toLowerCase().includes(hint)));
    return hinted || voices.find((v) => v.lang.startsWith("en")) || voices[0];
  };

  const speakResponse = (text: string) => {
    console.log("[LOG] Initializing Text-to-Speech...");
    setAgentState("speaking");

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    // higher pitch + slightly quicker pace for a light, youthful tone
    utterance.pitch = 1.7;
    utterance.rate = 1.05;

    utterance.onend = () => {
      console.log("[LOG] Agent finished speaking. State -> IDLE");
      setAgentState("idle");
    };

    window.speechSynthesis.speak(utterance);
  };

  // pupils follow the cursor, except while "thinking" — then they drift up and to the side
  const pupilOffset = useMemo(() => {
    if (agentState === "thinking") return { x: 4, y: -6 };
    const x = Math.max(-5, Math.min(5, mousePos.x * 6));
    const y = Math.max(-4, Math.min(4, mousePos.y * 5));
    return { x, y };
  }, [mousePos, agentState]);

  const browTilt = { idle: 4, listening: -6, thinking: -2, speaking: -4 }[agentState];
  const isActive = agentState !== "idle";

  const characterMark = (
    <svg width="220" height="240" viewBox="0 0 240 260" fill="none">
      <defs>
        <radialGradient id="headGrad" cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#FFF6DA" />
          <stop offset="45%" stopColor="#FFCD4D" />
          <stop offset="80%" stopColor="#F5A623" />
          <stop offset="100%" stopColor="#D98A12" />
        </radialGradient>
        <radialGradient id="aoShadow" cx="50%" cy="90%" r="55%">
          <stop offset="0%" stopColor="#B9740A" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#B9740A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#FFF6DE" />
        </linearGradient>
        <linearGradient id="hairGradA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFDD70" />
          <stop offset="100%" stopColor="#F0980F" />
        </linearGradient>
        <linearGradient id="hairGradB" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF0B8" />
          <stop offset="100%" stopColor="#F5A623" />
        </linearGradient>
        <filter id="softBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      {/* body */}
      <path d="M60 200 Q120 175 180 200 L188 258 L52 258 Z" fill="url(#bodyGrad)" stroke="#EFE0AE" strokeWidth="2" />
      <path d="M100 202 L120 222 L140 202 L134 196 L120 210 L106 196 Z" fill="#FFC93C" stroke="#2B2410" strokeWidth="2" strokeLinejoin="round" />

      {/* hair strands, behind head, subtle gradient shading */}
      {HAIR_ANGLES.map((angle, i) => (
        <g key={i} className="hair-strand" style={{ "--a": `${angle}deg`, animationDelay: `${i * 0.15}s` } as React.CSSProperties}>
          <path
            d="M120 78 C 112 50, 118 30, 128 18 C 132 34, 130 58, 122 78 Z"
            fill={i % 2 === 0 ? "url(#hairGradA)" : "url(#hairGradB)"}
            stroke="#2B2410"
            strokeWidth="1.6"
            strokeLinejoin="round"
            transform={`rotate(${angle}, 120, 78)`}
          />
        </g>
      ))}

      {/* ambient occlusion beneath head, for real depth */}
      <ellipse cx="120" cy="172" rx="58" ry="20" fill="url(#aoShadow)" />

      {/* head */}
      <circle cx="120" cy="130" r="72" fill="url(#headGrad)" stroke="#2B2410" strokeWidth="2.5" />
      {/* specular highlight, gives the sphere a glossy, premium finish */}
      <ellipse cx="96" cy="98" rx="22" ry="14" fill="#FFFFFF" opacity="0.55" filter="url(#softBlur)" transform="rotate(-24 96 98)" />

      {/* ears */}
      <circle cx="49" cy="132" r="10" fill="#FFC93C" stroke="#2B2410" strokeWidth="2" />
      <circle cx="191" cy="132" r="10" fill="#FFC93C" stroke="#2B2410" strokeWidth="2" />

      {/* cheeks */}
      <ellipse cx="82" cy="152" rx="10" ry="6" fill="#FF9F5A" opacity="0.45" />
      <ellipse cx="158" cy="152" rx="10" ry="6" fill="#FF9F5A" opacity="0.45" />

      {/* eyebrows */}
      <rect
        className="brow"
        x="82" y="103" width="26" height="6" rx="3"
        fill="#2B2410"
        style={{ "--r": `${browTilt}deg`, transformOrigin: "95px 106px" } as React.CSSProperties}
        transform={`rotate(${browTilt}, 95, 106)`}
      />
      <rect
        className="brow"
        x="132" y="103" width="26" height="6" rx="3"
        fill="#2B2410"
        style={{ "--r": `${-browTilt}deg`, transformOrigin: "145px 106px", animationDelay: "0.1s" } as React.CSSProperties}
        transform={`rotate(${-browTilt}, 145, 106)`}
      />

      {/* eyes */}
      <g>
        <ellipse cx="95" cy="128" rx="15" ry="18" fill="#FFFFFF" stroke="#2B2410" strokeWidth="2.5" />
        <circle
          cx={95 + pupilOffset.x}
          cy={128 + pupilOffset.y}
          r="6.5"
          fill="#2B2410"
          style={{ transition: "cx 0.15s ease-out, cy 0.15s ease-out" }}
        />
        <circle cx={97 + pupilOffset.x} cy={125 + pupilOffset.y} r="1.6" fill="#FFFFFF" />
        <rect className="eyelid" x="80" y="110" width="30" height="18" fill="#FFC93C" />
      </g>
      <g>
        <ellipse cx="145" cy="128" rx="15" ry="18" fill="#FFFFFF" stroke="#2B2410" strokeWidth="2.5" />
        <circle
          cx={145 + pupilOffset.x}
          cy={128 + pupilOffset.y}
          r="6.5"
          fill="#2B2410"
          style={{ transition: "cx 0.15s ease-out, cy 0.15s ease-out" }}
        />
        <circle cx={147 + pupilOffset.x} cy={125 + pupilOffset.y} r="1.6" fill="#FFFFFF" />
        <rect className="eyelid eyelid-r" x="130" y="110" width="30" height="18" fill="#FFC93C" />
      </g>

      {/* mouth */}
      {agentState === "idle" && (
        <path d="M104 160 Q120 172 136 160" stroke="#2B2410" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      )}
      {agentState === "listening" && (
        <ellipse cx="120" cy="163" rx="9" ry="7" fill="#7A3B1E" stroke="#2B2410" strokeWidth="2.5" />
      )}
      {agentState === "thinking" && (
        <path d="M110 163 Q120 158 132 165" stroke="#2B2410" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      )}
      {agentState === "speaking" && (
        <g style={{ transformOrigin: "120px 163px" }}>
          <ellipse className="mouth-talk" cx="120" cy="163" rx="11" ry="9" fill="#7A3B1E" stroke="#2B2410" strokeWidth="2.5" />
        </g>
      )}
    </svg>
  );

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-gradient-to-b from-[#FFFEFA] via-[#FFFDF6] to-[#FFF8E8] text-[#2B2410]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .font-display { font-family: 'Fredoka', system-ui, sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }

        @keyframes breathe { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-4px) scale(1.015); } }
        @keyframes sway { 0%, 100% { transform: rotate(var(--a)); } 50% { transform: rotate(calc(var(--a) + 3deg)); } }
        @keyframes blink { 0%, 92%, 100% { transform: scaleY(0); } 96% { transform: scaleY(1); } }
        @keyframes talk { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
        @keyframes brow-bounce { 0%, 100% { transform: translateY(0) rotate(var(--r)); } 50% { transform: translateY(-1.5px) rotate(var(--r)); } }
        @keyframes glow-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.85; } }
        @keyframes cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes gear-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes drift { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(14px, -10px); } }
        @keyframes drift-rev { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-12px, 12px); } }
        @keyframes wave-bar { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
        @keyframes sparkle { 0%, 100% { opacity: 0; transform: scale(0.4) rotate(0deg); } 50% { opacity: 1; transform: scale(1) rotate(90deg); } }

        .body-breathe { animation: breathe 4.2s ease-in-out infinite; }
        .hair-strand { animation: sway 3.6s ease-in-out infinite; transform-origin: 120px 78px; }
        .eyelid { transform-origin: center; animation: blink 4.8s ease-in-out infinite; }
        .eyelid-r { animation-delay: 0.06s; }
        .mouth-talk { transform-origin: center; animation: talk 0.32s ease-in-out infinite; }
        .brow { animation: brow-bounce 2.4s ease-in-out infinite; }
        .caption-cursor { animation: cursor-blink 1s step-end infinite; }
        .gear-spin { animation: gear-spin 14s linear infinite; }
        .blob-a { animation: drift 9s ease-in-out infinite; }
        .blob-b { animation: drift-rev 11s ease-in-out infinite; }
        .wave-bar { animation: wave-bar 0.7s ease-in-out infinite; }
        .sparkle { animation: sparkle 2.6s ease-in-out infinite; }
      `}</style>

      {/* soft ambient blobs */}
      <div className="blob-a pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[#FFE59A] opacity-40 blur-3xl" />
      <div className="blob-b pointer-events-none absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-[#FFD27A] opacity-35 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-[#FFF0C2] opacity-50 blur-3xl" />

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          animation: "glow-pulse 5s ease-in-out infinite",
          background: "radial-gradient(ellipse 32% 24% at 50% 26%, rgba(255,178,32,0.28), transparent 70%)",
        }}
      />

      {/* header */}
      <header className="relative z-10 flex items-start justify-between px-6 pt-8 sm:px-10 sm:pt-10">
        <div className="flex items-center gap-3">
          <svg className="gear-spin h-8 w-8 shrink-0 drop-shadow-sm sm:h-9 sm:w-9" viewBox="0 0 48 48" fill="none">
            <path
              d="M24 6l3 5.2 5.8-1.6 1.4 5.9 6 .6-1.2 5.9 5 3.4-3.6 4.8 3.6 4.8-5 3.4 1.2 5.9-6 .6-1.4 5.9-5.8-1.6L24 48l-3-5.2-5.8 1.6-1.4-5.9-6-.6 1.2-5.9-5-3.4 3.6-4.8L4 19l5-3.4-1.2-5.9 6-.6 1.4-5.9 5.8 1.6z"
              fill="#FFC93C"
              stroke="#2B2410"
              strokeWidth="1.6"
              strokeLinejoin="round"
              transform="translate(0 -3) scale(0.92)"
            />
            <circle cx="24" cy="21" r="7" fill="#FFFDF6" stroke="#2B2410" strokeWidth="1.6" />
          </svg>
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[#2B2410] sm:text-4xl">
              Volt
            </h1>
            <p className="mt-0.5 max-w-xs font-mono text-xs text-[#8a7a4a] sm:text-sm">
              Ask about industrial components — or ask Volt to pull camera footage and detect objects.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-[#F0DFA0] bg-white/80 px-3 py-1.5 font-mono text-xs text-[#5c4f22] shadow-sm backdrop-blur-sm sm:text-sm">
          <span className="h-2 w-2 rounded-full bg-[#FFC93C]" style={{ boxShadow: "0 0 8px #FFC93C" }} />
          {STATE_COPY[agentState].label}
        </div>
      </header>

      {/* character stage */}
      <div className="relative z-10 flex h-[40vh] items-center justify-center sm:h-[44vh]">
        <div
          className="body-breathe relative"
          style={{
            transform: `rotateY(${mousePos.x * 8}deg) rotateX(${-mousePos.y * 6}deg)`,
            transition: "transform 0.2s ease-out",
            transformStyle: "preserve-3d",
          }}
        >
          {/* ambient sparkles around the character */}
          {SPARKLES.map((s, i) => (
            <svg
              key={i}
              className="sparkle pointer-events-none absolute"
              style={{ left: s.x, top: s.y, animationDelay: `${s.delay}s`, opacity: isActive ? undefined : 0.6 }}
              width="14" height="14" viewBox="0 0 14 14"
            >
              <path d="M7 0 L8.5 5.5 L14 7 L8.5 8.5 L7 14 L5.5 8.5 L0 7 L5.5 5.5 Z" fill="#FFC93C" />
            </svg>
          ))}

          {/* soft stage ring beneath the character */}
          <div
            className="absolute left-1/2 top-[236px] h-3 w-44 -translate-x-1/2 rounded-full border border-[#F0DFA0]/60"
            style={{ background: "radial-gradient(ellipse, rgba(255,201,60,0.18), transparent 75%)" }}
          />
          <div
            className="absolute left-1/2 top-[242px] h-6 w-32 -translate-x-1/2 rounded-full"
            style={{ background: "radial-gradient(ellipse, rgba(43,36,16,0.16), transparent 70%)" }}
          />

          {characterMark}

          {/* mirrored reflection for a premium product-shot feel */}
          <div
            className="pointer-events-none absolute left-0 top-full w-full"
            style={{
              transform: "scaleY(-1)",
              opacity: 0.16,
              WebkitMaskImage: "linear-gradient(to bottom, black, transparent 65%)",
              maskImage: "linear-gradient(to bottom, black, transparent 65%)",
            }}
          >
            {characterMark}
          </div>
        </div>
      </div>

      {/* live caption — what the user is saying right now */}
      <div className="relative z-10 mx-auto w-full max-w-xl px-6">
        <div className="flex min-h-[3rem] items-center justify-center gap-3 rounded-2xl border border-[#F0E7C6] bg-white/85 px-5 py-3 text-center shadow-[0_4px_18px_rgba(235,163,36,0.12)] backdrop-blur-sm">
          {agentState === "listening" ? (
            <>
              <div className="flex items-end gap-[3px]">
                {[5, 10, 7, 12, 6].map((h, i) => (
                  <span
                    key={i}
                    className="wave-bar w-[3px] rounded-full bg-[#EBA324]"
                    style={{ height: h, animationDelay: `${i * 0.09}s` }}
                  />
                ))}
              </div>
              <p className="font-display text-lg text-[#5c4f22] sm:text-xl">
                {liveCaption || "…"}
                <span className="caption-cursor text-[#EBA324]">|</span>
              </p>
            </>
          ) : (
            <p className="font-mono text-xs text-[#b9ac7c]">Live transcript appears here while you speak</p>
          )}
        </div>
      </div>

      {/* controls */}
      <div className="relative z-10 mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-6 pb-10 pt-6">
        <button
          onClick={startListening}
          disabled={agentState !== "idle"}
          aria-label="Start listening"
          className={`group relative flex h-16 w-16 items-center justify-center rounded-full border-2 transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EBA324] ${
            agentState === "idle"
              ? "cursor-pointer border-[#F0DFA0] bg-gradient-to-b from-[#FFD760] to-[#FFC93C] shadow-[0_8px_22px_rgba(255,178,32,0.45)] hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(255,178,32,0.55)]"
              : "cursor-not-allowed border-[#F0E7C6] bg-[#FFF3D0] opacity-60"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2B2410" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="22"></line>
          </svg>
        </button>

        <p className="font-mono text-xs text-[#8a7a4a]">{STATE_COPY[agentState].hint}</p>

        {/* transcript history */}
        <div className="w-full">
          <p className="mb-2 px-1 font-mono text-[11px] uppercase tracking-wide text-[#c9bd8f]">Conversation</p>
          <div className="h-40 w-full overflow-y-auto rounded-2xl border border-[#F0E7C6] bg-white/90 p-4 shadow-[0_4px_18px_rgba(43,36,16,0.05)] backdrop-blur-sm">
            {transcript.length === 0 ? (
              <p className="font-mono text-xs text-[#b9ac7c]">No conversation yet — press the microphone to begin.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {transcript.map((line, i) => (
                  <div key={i} className="flex gap-3 font-mono text-xs leading-relaxed sm:text-sm">
                    <span className="mt-0.5 shrink-0 text-[#b9ac7c]">{line.time}</span>
                    <span
                      className={
                        line.from === "user"
                          ? "text-[#8a7a4a]"
                          : line.from === "system"
                          ? "text-[#D2691E]"
                          : "text-[#B8860B]"
                      }
                    >
                      {line.from === "user" ? "You — " : line.from === "system" ? "System — " : "Volt — "}
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
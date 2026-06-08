import React, { useState, useRef, useEffect } from "react";
import { SummaryData } from "../types";
import { Send, Loader2, MessageCircle, AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface DocumentChatProps {
  data: SummaryData;
  /** Fonction pour charger le sourceText si pas encore en mémoire */
  loadSourceText?: (id: string) => Promise<string | null>;
}

export function DocumentChat({ data, loadSourceText }: DocumentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sourceText, setSourceText] = useState<string | null>(data.sourceText ?? null);
  const [sourceLoaded, setSourceLoaded] = useState(!!data.sourceText);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Charger le sourceText paresseusement si non présent
  useEffect(() => {
    if (sourceLoaded || sourceText) return;
    if (!data.id) { setSourceLoaded(true); return; }

    // Essayer le localStorage d'abord
    const local = localStorage.getItem(`ilm-source-${data.id}`);
    if (local) {
      setSourceText(local);
      setSourceLoaded(true);
      return;
    }

    // Sinon rappeler le helper fourni par le parent
    if (loadSourceText) {
      loadSourceText(data.id).then((text) => {
        if (text) setSourceText(text);
        setSourceLoaded(true);
      });
    } else {
      setSourceLoaded(true);
    }
  }, [data.id, sourceLoaded, sourceText, loadSourceText]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const submit = async () => {
    const q = input.trim();
    if (!q || isLoading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setIsLoading(true);

    try {
      // summary sans sourceText pour alléger la requête
      const { sourceText: _st, ...summaryOnly } = data;
      const body: Record<string, unknown> = { question: q, summary: summaryOnly };
      if (sourceText) body.sourceText = sourceText;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? `Erreur ${res.status}`);
      }

      const { answer } = await res.json() as { answer: string };
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠ ${e.message ?? "Une erreur est survenue."}` },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const hasDegradedMode = sourceLoaded && !sourceText;

  return (
    <div className="flex flex-col gap-4 w-full">
      {hasDegradedMode && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-sans">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Le texte source n'est plus disponible pour ce document (chargé depuis la bibliothèque).
            Les réponses seront basées sur le résumé structuré uniquement.
          </span>
        </div>
      )}

      {/* Zone de messages */}
      <div className="flex flex-col gap-4 min-h-[280px] max-h-[480px] overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-4 py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-sand-500/10 border border-sand-500/20 flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-sand-500/60" />
            </div>
            <div className="space-y-1">
              <p className="text-sand-100/80 font-serif text-lg">Interrogez le document</p>
              <p className="text-white/40 text-sm font-sans max-w-xs">
                Posez une question sur <span className="italic">{data.title}</span>.
                Je réponds uniquement d'après son contenu.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {[
                "Quelle est la thèse principale ?",
                "Explique le concept le plus important.",
                "Quelles sont les limites de cet argument ?",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="px-3 py-1.5 rounded-full border border-white/10 text-xs text-white/50 hover:text-white/80 hover:border-sand-500/30 transition-colors font-sans"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              m.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] px-4 py-3 rounded-2xl font-sans text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-sand-500 text-ink-900 rounded-br-sm font-medium"
                  : "bg-white/[0.04] border border-white/10 text-white/85 rounded-bl-sm"
              )}
            >
              {m.role === "assistant" ? (
                <div className="prose dark:prose-invert prose-sm max-w-none prose-p:text-white/85 prose-p:my-1 prose-strong:text-white prose-headings:text-white/90">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-white/[0.04] border border-white/10 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-sand-500 animate-spin" />
              <span className="text-white/40 text-sm font-sans">Lecture du document…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-end gap-3 border border-white/10 rounded-2xl p-3 bg-white/[0.02] focus-within:border-sand-500/40 transition-colors">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Posez une question sur ce document…"
          className="flex-1 resize-none bg-transparent text-sm text-white/90 placeholder:text-white/30 focus:outline-none font-sans leading-relaxed max-h-32 overflow-y-auto"
          style={{ minHeight: "1.5rem" }}
          onInput={(e) => {
            const t = e.currentTarget;
            t.style.height = "auto";
            t.style.height = `${Math.min(t.scrollHeight, 128)}px`;
          }}
        />
        <button
          onClick={submit}
          disabled={!input.trim() || isLoading}
          className={cn(
            "shrink-0 p-2.5 rounded-xl transition-all duration-200",
            input.trim() && !isLoading
              ? "bg-sand-500 text-ink-900 hover:bg-sand-300 shadow-[0_0_16px_-4px_rgba(201,168,76,0.4)]"
              : "bg-white/5 text-white/20 cursor-not-allowed"
          )}
          aria-label="Envoyer"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      <p className="text-center text-[10px] text-white/20 font-sans -mt-2">
        Entrée pour envoyer · Maj+Entrée pour nouvelle ligne
      </p>
    </div>
  );
}

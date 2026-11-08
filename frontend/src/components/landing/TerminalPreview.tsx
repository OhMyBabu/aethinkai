import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, TerminalSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useStore } from "@/data/store";
import { useToast } from "@/components/common/Toast";

/**
 * Terminal preview — three slides (cURL / Python / Node) against the gateway base URL
 * URL. Syntax colouring uses only the five brand hues (orange, burnt, warm
 * white, gray + alpha). Auto-advances unless reduced motion is on or the pointer
 * is inside the panel.
 */

type TokenKind = "kw" | "str" | "num" | "cmt" | "punct" | "var" | "plain";
interface Token {
  text: string;
  kind: TokenKind;
}

/**
 * Gateway host shown in the snippet. Defaults to AethinkAI's own gateway; set
 * VITE_GATEWAY_BASE_URL / VITE_GATEWAY_MODEL in .env to point somewhere else
 * without touching this file.
 */
const BASE = (import.meta.env.VITE_GATEWAY_BASE_URL ?? `${window.location.origin}/v1`).replace(/\/$/, "");
const MODEL = import.meta.env.VITE_GATEWAY_MODEL ?? "deepseek-v4.1-flash";

const snippets: Array<{ id: string; label: string; filename: string; lines: string[] }> = [
  {
    id: "curl",
    label: "cURL",
    filename: "bash",
    lines: [
      `curl -X POST ${BASE}/chat/completions \\`,
      `  -H "Authorization: Bearer sk-•••" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{`,
      `    "model": "${MODEL}",`,
      `    "messages": [{ "role": "user", "content": "Halo" }]`,
      `  }'`,
    ],
  },
  {
    id: "python",
    label: "Python",
    filename: "main.py",
    lines: [
      `from openai import OpenAI`,
      ``,
      `client = OpenAI(`,
      `    base_url="${BASE}",`,
      `    api_key="sk-•••",`,
      `)`,
      ``,
      `res = client.chat.completions.create(`,
      `    model="${MODEL}",`,
      `    messages=[{"role": "user", "content": "Halo"}],`,
      `)`,
      `print(res.choices[0].message.content)`,
    ],
  },
  {
    id: "node",
    label: "Node.js",
    filename: "app.ts",
    lines: [
      `import OpenAI from "openai";`,
      ``,
      `const client = new OpenAI({`,
      `  baseURL: "${BASE}",`,
      `  apiKey: process.env.AETHINK_KEY,`,
      `});`,
      ``,
      `const res = await client.chat.completions.create({`,
      `  model: "${MODEL}",`,
      `  messages: [{ role: "user", content: "Halo" }],`,
      `});`,
      `console.log(res.choices[0].message.content);`,
    ],
  },
];

const KEYWORDS = new Set([
  "curl", "from", "import", "new", "const", "await", "async", "print", "return",
  "process", "client", "res", "OpenAI",
]);

function tokenize(line: string): Token[] {
  if (line.trim().startsWith("#") || line.trim().startsWith("//")) {
    return [{ text: line, kind: "cmt" }];
  }
  const tokens: Token[] = [];
  const pattern = /("[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|\s+|.)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const raw = match[0];
    let kind: TokenKind = "plain";
    if (/^["'`]/.test(raw)) kind = "str";
    else if (/^\d/.test(raw)) kind = "num";
    else if (/^[A-Za-z_$]/.test(raw)) kind = KEYWORDS.has(raw) ? "kw" : "var";
    else if (/^[\s]+$/.test(raw)) kind = "plain";
    else kind = "punct";
    tokens.push({ text: raw, kind });
  }
  return tokens;
}

const kindClass: Record<TokenKind, string> = {
  kw: "text-flame",
  str: "text-warm",
  num: "text-flame/80",
  cmt: "text-ash",
  punct: "text-ash/70",
  var: "text-[#e7b08c]",
  plain: "text-warm/85",
};

export function TerminalPreview({ className }: { className?: string }) {
  const { state } = useStore();
  const { toast } = useToast();
  const reduce = state.prefs.reducedMotion;
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  const active = snippets[index];
  const tokenLines = useMemo(() => active.lines.map((line) => tokenize(line)), [active]);

  useEffect(() => {
    if (reduce || hovered) return;
    timer.current = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % snippets.length);
    }, 6200);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [reduce, hovered, index]);

  const copy = async () => {
    const text = active.lines.join("\n");
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // headless / non-secure contexts: fall back to a hidden textarea
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand("copy");
        document.body.removeChild(area);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      toast("Snippet copied", { description: `${active.label} · key is masked on purpose.` });
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      toast("Copy blocked by the browser", { description: "Select the snippet manually.", variant: "warning" });
    }
  };

  return (
    <div
      className={cn("surface overflow-hidden p-0", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
    >
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-ash/14 bg-[#17181B] px-3 py-2 shadow-[inset_0_1px_0_rgba(250,248,244,0.05)]">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-ash/35" />
          <span className="size-2.5 rounded-full bg-ash/25" />
          <span className="size-2.5 rounded-full bg-flame/70" />
        </span>
        <p className="ml-1 flex items-center gap-1.5 text-[10.5px] font-medium text-ash">
          <TerminalSquare size={11} aria-hidden />
          aethinkai — quickstart
        </p>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-ash/15 bg-[#101113] p-0.5" role="tablist" aria-label="Code language">
          {snippets.map((snippet, i) => (
            <button
              key={snippet.id}
              role="tab"
              aria-selected={index === i}
              type="button"
              onClick={() => setIndex(i)}
              className={cn(
                "rounded-md px-2 py-1 text-[10.5px] font-medium transition active:scale-[0.97] max-sm:h-11 max-sm:rounded-lg max-sm:px-3 max-sm:text-[12px]",
                index === i
                  ? "bg-flame/[0.18] text-flame ring-1 ring-inset ring-flame/25"
                  : "text-ash/90 hover:text-warm",
              )}
            >
              {snippet.label}
            </button>
          ))}
        </div>
      </div>

      {/* filename strip */}
      <div className="flex items-center justify-between border-b border-ash/12 bg-[#17181B] px-3 py-1.5">
        <span className="font-mono text-[10px] text-ash/90">
          {active.filename} <span className="text-ash/50">· slide {index + 1}/3</span>
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ash max-sm:h-11 max-sm:rounded-lg max-sm:px-2.5 max-sm:text-[12px] transition active:bg-warm/10 active:scale-[0.97] hover:bg-warm/[0.06] hover:text-warm"
          aria-label="Copy snippet"
        >
          {copied ? <Check size={10} className="text-flame" /> : <Copy size={10} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* code */}
      <div className="relative min-h-[248px] bg-[#101113] px-3 py-3 sm:min-h-[264px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(133,136,139,0.07) 1px, transparent 1px), linear-gradient(rgba(133,136,139,0.05) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active.id}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-x-auto"
          >
            <pre className="font-mono text-[10.5px] leading-[1.75] max-[899px]:text-[12px] max-[899px]:leading-[1.85] sm:text-[11.5px]">
              <code>
                {tokenLines.map((tokens, lineIndex) => (
                  <span key={lineIndex} className="flex whitespace-pre">
                    <span aria-hidden className="mr-3 w-4 shrink-0 select-none text-right text-ash/35">
                      {lineIndex + 1}
                    </span>
                    <span className="min-w-0">
                      {tokens.map((token, tokenIndex) => (
                        <span key={tokenIndex} className={kindClass[token.kind]}>
                          {token.text}
                        </span>
                      ))}
                    </span>
                  </span>
                ))}
                <span className="flex whitespace-pre">
                  <span aria-hidden className="mr-3 w-4 shrink-0 select-none text-right text-ash/35">
                    {tokenLines.length + 1}
                  </span>
                  <span className="text-flame">$</span>
                  <motion.span
                    aria-hidden
                    className="ml-1 inline-block h-[13px] w-[7px] translate-y-[2px] bg-flame/80"
                    animate={reduce ? { opacity: 1 } : { opacity: [1, 1, 0, 0] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                  />
                </span>
              </code>
            </pre>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* response */}
      <div className="border-t border-ash/12 bg-[#121316] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-flame/30 bg-flame/10 px-1.5 py-0.5 font-medium text-flame">
            <span className="size-1.5 rounded-full bg-flame" aria-hidden />
            200 OK
          </span>
          <span className="text-ash">·</span>
          <span className="font-mono text-ash">stream</span>
          <span className="text-ash">·</span>
          <span className="font-mono text-warm/70">chatcmpl_9f2c1a</span>
        </div>
        <p className="mt-1.5 truncate font-mono text-[10px] text-ash">
          <span className="text-warm/70">{`{ "model": "${MODEL}"`}</span>
          <span>, </span>
          <span className="text-warm/70">{`"usage": { "in": 96, "out": 214 } }`}</span>
        </p>
      </div>

      {/* footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ash/12 bg-[#151619] px-3 py-2 text-[10px] text-ash">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-flame/80" aria-hidden />
          Example snippet · key masked
        </span>
        <Link to="/login" className="inline-flex items-center gap-1 font-medium text-flame hover:underline max-sm:h-11 max-sm:px-1">
          Open dashboard
        </Link>
      </div>
    </div>
  );
}

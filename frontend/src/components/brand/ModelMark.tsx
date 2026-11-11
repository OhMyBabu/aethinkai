import claudeBrand from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import anthropicMono from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import deepseekBrand from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import deepseekMono from "@lobehub/icons-static-svg/icons/deepseek.svg?raw";
import qwenBrand from "@lobehub/icons-static-svg/icons/qwen-color.svg?raw";
import qwenMono from "@lobehub/icons-static-svg/icons/qwen.svg?raw";
import glmBrand from "@lobehub/icons-static-svg/icons/zhipu-color.svg?raw";
import glmMono from "@lobehub/icons-static-svg/icons/zhipu.svg?raw";
import kimiBrand from "@lobehub/icons-static-svg/icons/kimi-color.svg?raw";
import kimiMono from "@lobehub/icons-static-svg/icons/kimi.svg?raw";
import minimaxBrand from "@lobehub/icons-static-svg/icons/minimax-color.svg?raw";
import minimaxMono from "@lobehub/icons-static-svg/icons/minimax.svg?raw";
import moonshotMono from "@lobehub/icons-static-svg/icons/moonshot.svg?raw";
import geminiBrand from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import geminiMono from "@lobehub/icons-static-svg/icons/gemini.svg?raw";
import openaiMono from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import mistralBrand from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import mistralMono from "@lobehub/icons-static-svg/icons/mistral.svg?raw";
import grokMono from "@lobehub/icons-static-svg/icons/grok.svg?raw";
import type { Provider } from "@/types";
import { cn } from "@/lib/cn";

type Variant = "mono" | "brand";

type IconPair = { mono: string; brand?: string };

/** Official vendor marks from @lobehub/icons-static-svg (MIT). Order matters: first match wins. */
const ICONS: Array<{ test: RegExp; icon: IconPair }> = [
  { test: /claude|anthropic/i, icon: { mono: anthropicMono, brand: claudeBrand } },
  { test: /deepseek/i, icon: { mono: deepseekMono, brand: deepseekBrand } },
  { test: /qwen|tongyi|qwq/i, icon: { mono: qwenMono, brand: qwenBrand } },
  { test: /glm|chatglm|zhipu/i, icon: { mono: glmMono, brand: glmBrand } },
  { test: /kimi|moonshot/i, icon: { mono: kimiMono, brand: kimiBrand } },
  { test: /minimax|abab/i, icon: { mono: minimaxMono, brand: minimaxBrand } },
  { test: /gemini|gemma/i, icon: { mono: geminiMono, brand: geminiBrand } },
  { test: /mistral|mixtral|codestral/i, icon: { mono: mistralMono, brand: mistralBrand } },
  { test: /grok/i, icon: { mono: grokMono } },
  { test: /gpt|openai|o[1-9][a-z-]/i, icon: { mono: openaiMono } },
  { test: /moonshot/i, icon: { mono: moonshotMono } },
];

/**
 * Resolve by model id first, then by provider name. The provider branch matches the same
 * regex table instead of comparing regex sources, comparing sources silently missed every
 * vendor whose pattern was multi-token (`glm|chatglm|zhipu`, `kimi|moonshot`), which rendered
 * blank marks for GLM, Kimi and Claude.
 */
function resolve(modelId?: string, provider?: Provider): IconPair | null {
  if (modelId) {
    const hit = ICONS.find((entry) => entry.test.test(modelId));
    if (hit) return hit.icon;
  }
  if (provider) {
    const hit = ICONS.find((entry) => entry.test.test(provider));
    if (hit) return hit.icon;
  }
  return null;
}

function normalize(svg: string, size: number): string {
  return svg
    .replace(/width="1em"/g, `width="${size}"`)
    .replace(/height="1em"/g, `height="${size}"`)
    .replace(/\sstyle="[^"]*"/g, "");
}

/**
 * Official model mark resolved from the model id (e.g. `mk/claude-fable-5` → Claude),
 * falling back to provider name, then to a neutral letter tile.
 */
export function ModelMark({
  modelId,
  provider,
  size = 16,
  variant = "brand",
  className,
}: {
  modelId?: string;
  provider?: Provider;
  size?: number;
  variant?: Variant;
  className?: string;
}) {
  const icon = resolve(modelId, provider);
  const svg = icon ? (variant === "brand" ? icon.brand ?? icon.mono : icon.mono) : null;

  if (!svg) {
    const letter = (modelId?.split("/").pop() ?? provider ?? "?").slice(0, 1).toUpperCase();
    return (
      <span
        className={cn("grid place-items-center rounded-[4px] bg-warm/[0.08] font-semibold text-warm/70", className)}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.55)) }}
        aria-hidden
      >
        {letter}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: normalize(svg, size) }}
    />
  );
}
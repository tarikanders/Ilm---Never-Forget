import React, { useState, useEffect } from "react";
import { Loader2, FileText, BrainCircuit, Network, CheckCircle2 } from "lucide-react";
import { cn } from "../lib/utils";

const LOADING_STEPS = [
  { id: 1, label: "Extraction du contenu brut...", icon: FileText, duration: 2500 },
  { id: 2, label: "Identification de la thèse centrale...", icon: BrainCircuit, duration: 4000 },
  { id: 3, label: "Synthèse détaillée des concepts clés...", icon: Network, duration: 6000 },
  { id: 4, label: "Génération des citations et leçons...", icon: CheckCircle2, duration: Infinity }
];

interface LoadingViewProps {
  current?: number;
  total?: number;
  fileName?: string;
}

export function LoadingView({ current, total, fileName }: LoadingViewProps) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    setCurrentStep(0);
    let timeoutId: number;

    const advanceStep = (stepIndex: number) => {
      if (stepIndex >= LOADING_STEPS.length - 1) return;
      timeoutId = window.setTimeout(() => {
        setCurrentStep(stepIndex + 1);
        advanceStep(stepIndex + 1);
      }, LOADING_STEPS[stepIndex].duration);
    };

    advanceStep(0);
    return () => clearTimeout(timeoutId);
  }, [current]);

  const isBatch = total !== undefined && total > 1;

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-12 animate-in fade-in zoom-in-95 duration-1000 -mt-16 w-full max-w-xl mx-auto px-4">
      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 bg-sand-500/5 blur-3xl rounded-full scale-150"></div>
        <div className="w-32 h-32 border border-sand-500/20 rounded-full animate-ping absolute duration-[3000ms]"></div>
        <div className="w-40 h-40 border border-sand-500/10 rounded-full animate-pulse absolute duration-[4000ms]"></div>
        <div className="w-24 h-24 flex items-center justify-center bg-sand-500/10 rounded-full backdrop-blur-md border border-sand-500/30 shadow-[0_0_30px_rgba(201,168,76,0.15)] relative z-10">
          <Loader2 className="w-10 h-10 text-sand-500 animate-spin" />
        </div>
      </div>

      <div className="text-center space-y-3 w-full">
        <h2 className="text-2xl md:text-3xl font-serif text-sand-100 tracking-tight">
          {isBatch ? `Document ${current} sur ${total}` : "Analyse en profondeur"}
        </h2>
        {fileName && (
          <p className="text-sand-500/80 font-sans text-sm truncate max-w-xs mx-auto">{fileName}</p>
        )}
        <p className="text-white/40 font-sans text-sm md:text-base">
          L'intelligence artificielle distille l'essence du document.
        </p>
        {isBatch && (
          <div className="w-full max-w-xs mx-auto mt-2">
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-sand-500 rounded-full transition-all duration-700"
                style={{ width: `${((current! - 1) / total!) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4 relative">
        <div className="absolute left-4 top-4 bottom-4 w-px bg-white/10"></div>

        {LOADING_STEPS.map((step, index) => {
          const Icon = step.icon;
          const isPast = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div
              key={step.id}
              className={cn(
                "flex items-center gap-4 p-3 rounded-xl transition-all duration-700 relative z-10",
                isCurrent ? "bg-white/5 border border-white/10 shadow-lg" : "bg-transparent border border-transparent",
                isPast ? "opacity-40" : isCurrent ? "opacity-100 translate-x-2" : "opacity-20"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors duration-500",
                isPast ? "bg-sand-500/20 text-sand-500" : isCurrent ? "bg-sand-500 text-ink-900 shadow-[0_0_15px_rgba(201,168,76,0.4)]" : "bg-white/10 text-white/40"
              )}>
                {isPast ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={cn(
                "font-sans text-sm tracking-wide transition-colors duration-500",
                isCurrent ? "text-sand-100 font-medium" : "text-white/60"
              )}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

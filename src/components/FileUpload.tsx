import React, { useCallback, useState } from "react";
import { UploadCloud, File, X, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

interface FileUploadProps {
  onUpload: (files: File[], depth: string) => void;
}

export function FileUpload({ onUpload }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [depth, setDepth] = useState<"flash" | "standard" | "deep">("standard");

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const valid = Array.from(incoming).filter(f =>
      /\.(pdf|txt|epub)$/i.test(f.name) || f.type === "application/epub+zip"
    );
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    addFiles(e.target.files);
    e.target.value = "";
  };

  const removeFile = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    setFiles(prev => prev.filter(f => f.name !== name));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length > 0) {
      onUpload(files, depth);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto flex flex-col gap-8 animate-in fade-in zoom-in-95 duration-700">
      <div
        className={cn(
          "relative group overflow-hidden border border-white/10 rounded-2xl p-12 transition-all duration-500 ease-out",
          "bg-gradient-to-b from-white/[0.03] to-transparent",
          isDragging ? "border-sand-500 bg-sand-500/5 shadow-[0_0_40px_-10px_rgba(201,168,76,0.3)] scale-[1.02]" : "hover:border-white/20"
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".pdf,.txt,.epub,application/epub+zip"
          multiple
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          onChange={handleChange}
          title=""
        />

        <div className="flex flex-col items-center justify-center text-center gap-4 relative z-0 pointer-events-none">
          {files.length > 0 ? (
            <div className="w-full flex flex-col gap-3 fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto w-full">
                {files.map(f => (
                  <div key={f.name} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 text-left">
                    <File className="w-5 h-5 text-sand-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-serif text-sand-100 truncate">{f.name}</p>
                      <p className="text-xs text-white/40">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => removeFile(e, f.name)}
                      className="pointer-events-auto shrink-0 rounded-full bg-white/5 hover:bg-white/10 transition-colors p-1.5 text-white/50 hover:text-white/90"
                      aria-label="Retirer le fichier"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-white/40 mt-1">
                {files.length} document{files.length > 1 ? "s" : ""} sélectionné{files.length > 1 ? "s" : ""} — cliquez pour en ajouter d'autres
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full border border-dashed border-white/20 flex items-center justify-center group-hover:border-sand-500/50 transition-colors duration-500">
                <UploadCloud className="w-6 h-6 text-white/40 group-hover:text-sand-500 transition-colors duration-500" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-serif text-sand-100 font-medium">Téléversez vos textes</h3>
                <p className="text-white/50 text-sm font-sans max-w-[250px] mx-auto">
                  Glissez-déposez un ou plusieurs documents, ou cliquez pour parcourir
                </p>
              </div>
              <div className="flex gap-2 mt-2">
                <span className="px-2.5 py-1 rounded bg-white/5 font-mono text-xs text-white/40">.PDF</span>
                <span className="px-2.5 py-1 rounded bg-white/5 font-mono text-xs text-white/40">.EPUB</span>
                <span className="px-2.5 py-1 rounded bg-white/5 font-mono text-xs text-white/40">.TXT</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 items-center justify-between border border-white/10 rounded-2xl p-6 bg-white/[0.01]">
        <div className="flex flex-col gap-3 w-full sm:w-auto">
          <label className="text-xs uppercase tracking-widest text-white/40 font-semibold font-sans">Profondeur d'analyse</label>
          <div className="flex bg-white/5 p-1 rounded-lg w-full sm:w-fit font-sans text-sm border border-white/5">
            {[
              { id: "flash", label: "Rapide" },
              { id: "standard", label: "Standard" },
              { id: "deep", label: "Détaillé" }
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDepth(d.id as any)}
                className={cn(
                  "flex-1 sm:flex-none px-4 py-2 rounded-md transition-all duration-300 capitalize",
                  depth === d.id
                    ? "bg-sand-500 text-ink-900 font-medium shadow-sm"
                    : "text-white/60 hover:text-white"
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={files.length === 0}
          className={cn(
            "w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-sans font-medium transition-all duration-500",
            files.length > 0
              ? "bg-sand-500 hover:bg-sand-300 text-ink-900 shadow-[0_0_30px_-5px_rgba(201,168,76,0.3)] hover:shadow-[0_0_40px_-5px_rgba(201,168,76,0.5)] transform hover:-translate-y-0.5"
              : "bg-white/5 text-white/30 cursor-not-allowed"
          )}
        >
          <Sparkles className="w-5 h-5" />
          <span>
            {files.length > 1 ? `Synthétiser (${files.length})` : "Synthétiser"}
          </span>
        </button>
      </div>
    </form>
  );
}

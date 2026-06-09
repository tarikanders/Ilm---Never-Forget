/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { FileUpload } from "./components/FileUpload";
import { SummaryView } from "./components/SummaryView";
import { GraphView } from "./components/GraphView";
import { LoadingView } from "./components/LoadingView";
import { FeedView } from "./components/FeedView";
import { SummaryData } from "./types";
import { BookMarked, Loader2, Library, ArrowLeft, Search, List, Network, LogIn, LogOut, Tags, UserCircle, Plus, Sparkles } from "lucide-react";
import { cn } from "./lib/utils";
import { auth, db, signInWithGoogle, logout, handleFirestoreError } from "./lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, query, onSnapshot, setDoc, doc, deleteDoc } from "firebase/firestore";

export default function App() {
  const [appState, setAppState] = useState<"feed" | "upload" | "loading" | "summary" | "library">("feed");
  const [libraryView, setLibraryView] = useState<"list" | "graph">("list");
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isZenMode, setIsZenMode] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  
  const [library, setLibrary] = useState<SummaryData[]>(() => {
    try {
      const saved = localStorage.getItem("ilm-library");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [selectedAuthor, setSelectedAuthor] = useState<string>("");

  useEffect(() => {
    localStorage.setItem("ilm-library", JSON.stringify(library));
  }, [library]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        // Sync local library to cloud
        const localLib = localStorage.getItem("ilm-library");
        if (localLib) {
          try {
            const parsed = JSON.parse(localLib) as SummaryData[];
            for (const item of parsed) {
              if (item.id) {
                const updatedItem = { ...item, userId: user.uid };
                // Using setDoc to overwrite/create without checking existence for simplicity
                await setDoc(doc(db, `users/${user.uid}/summaries`, item.id), updatedItem, { merge: true });
              }
            }
          } catch (e) {
            console.error("Local sync error", e);
          }
        }

        const q = query(collection(db, `users/${user.uid}/summaries`));
        const unsubStore = onSnapshot(q, (snapshot) => {
          const docs = snapshot.docs.map(doc => doc.data() as SummaryData);
          setLibrary(docs);
        }, (error) => {
          handleFirestoreError(error, "list" as any, `users/${user.uid}/summaries`);
        });
        return () => unsubStore();
      }
    });
    return () => unsubscribe();
  }, []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    library.forEach(item => {
      if (item.category) tags.add(item.category);
      item.keywords?.forEach(k => tags.add(k));
    });
    return Array.from(tags).sort();
  }, [library]);

  const allAuthors = useMemo(() => {
    const authors = new Set<string>();
    library.forEach(item => {
      if (item.author) authors.add(item.author);
    });
    return Array.from(authors).sort();
  }, [library]);

  const filteredLibrary = useMemo(() => {
    return library.filter(item => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = item.title?.toLowerCase().includes(q) || 
                            item.author?.toLowerCase().includes(q) || 
                            item.category?.toLowerCase().includes(q);
      
      const matchesTag = selectedTag ? (item.category === selectedTag || item.keywords?.includes(selectedTag)) : true;
      const matchesAuthor = selectedAuthor ? (item.author === selectedAuthor) : true;

      return matchesSearch && matchesTag && matchesAuthor;
    });
  }, [library, searchQuery, selectedTag, selectedAuthor]);

  /** Charger le texte source pour le chat — localStorage d'abord, puis Firestore */
  const loadSourceText = async (id: string): Promise<string | null> => {
    const local = localStorage.getItem(`ilm-source-${id}`);
    if (local) return local;
    // Si connecté, essayer Firestore
    if (currentUser) {
      try {
        const { getDoc } = await import("firebase/firestore");
        const snap = await getDoc(doc(db, `users/${currentUser.uid}/sources`, id));
        if (snap.exists()) {
          const text = snap.data().text as string;
          // Mettre en cache local
          try { localStorage.setItem(`ilm-source-${id}`, text); } catch {}
          return text;
        }
      } catch {}
    }
    return null;
  };

  const processSingleFile = async (file: File, depth: string): Promise<SummaryData> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("depth", depth);

    const response = await fetch("/api/summarize", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Échec du traitement de "${file.name}".`);
    }

    const raw: SummaryData = await response.json();
    const id = Date.now().toString();

    // Persister le sourceText séparément (localStorage + Firestore)
    if (raw.sourceText) {
      try { localStorage.setItem(`ilm-source-${id}`, raw.sourceText); } catch {}
    }

    const { sourceText: _st, ...summaryWithoutSource } = raw;
    return {
      ...summaryWithoutSource,
      id,
      userId: currentUser?.uid || "local",
      createdAt: new Date().toISOString(),
      // Conserver sourceText en mémoire pour la session courante uniquement
      sourceText: raw.sourceText,
    };
  };

  const handleUpload = async (files: File[], depth: string) => {
    setAppState("loading");
    setErrorMessage(null);

    const errors: string[] = [];
    let lastSummary: SummaryData | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBatchProgress({ current: i + 1, total: files.length, fileName: file.name });

      try {
        const newSummary = await processSingleFile(file, depth);
        lastSummary = newSummary;

        // Ne stocker QUE le résumé (sans sourceText) dans Firestore / localStorage
        const { sourceText: _st, ...summaryToStore } = newSummary;

        if (currentUser) {
          try {
            await setDoc(doc(db, `users/${currentUser.uid}/summaries`, newSummary.id!), summaryToStore);
            // Stocker le sourceText dans une collection séparée (documents légers)
            if (_st && newSummary.id) {
              await setDoc(doc(db, `users/${currentUser.uid}/sources`, newSummary.id), { text: _st }).catch(() => {});
            }
          } catch (error) {
            handleFirestoreError(error, "create" as any, `users/${currentUser.uid}/summaries/${newSummary.id}`);
          }
        } else {
          setLibrary((prev) => [newSummary, ...prev]);
        }
      } catch (error: any) {
        console.error(error);
        errors.push(error.message || `Erreur sur "${file.name}".`);
      }
    }

    setBatchProgress(null);

    if (errors.length > 0) {
      setErrorMessage(errors.join(" | "));
    }

    if (files.length === 1 && lastSummary) {
      setSummaryData(lastSummary);
      setAppState("summary");
    } else {
      setAppState(lastSummary ? "library" : "upload");
    }
  };

  const loadFromLibrary = (item: SummaryData) => {
    setSummaryData(item);
    setAppState("summary");
  };

  // ─── Feed plein-écran (écran d'accueil par défaut) ──────────────────────────
  // FeedView est full-bleed (h-100dvh, snap-scroll) → on bypasse le layout paddé.
  if (appState === "feed") {
    return (
      <div className="relative h-[100dvh] w-full bg-ink-900 selection:bg-sand-500/30 selection:text-sand-100">
        {/* Nav flottante minimale */}
        <div className="fixed top-0 inset-x-0 z-40 flex justify-between items-center px-4 py-3 bg-gradient-to-b from-ink-900/80 to-transparent pointer-events-none">
          <button
            onClick={() => setAppState("upload")}
            className="flex items-center gap-2 group pointer-events-auto"
          >
            <BookMarked className="w-5 h-5 text-sand-500 group-hover:rotate-12 transition-transform duration-300" />
            <span className="text-lg font-serif tracking-wide font-medium">Ilm.</span>
          </button>
          <div className="flex items-center gap-2 pointer-events-auto">
            {library.length > 0 && (
              <button
                onClick={() => setAppState("library")}
                className="flex items-center gap-2 px-3 py-2 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors text-sm font-sans bg-ink-800/60 backdrop-blur-sm"
                title="Ma Bibliothèque"
              >
                <Library className="w-4 h-4 text-sand-500" />
                <span className="hidden sm:inline">Bibliothèque</span>
              </button>
            )}
            <button
              onClick={() => setAppState("upload")}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-sand-500 text-ink-900 hover:bg-sand-300 transition-colors"
              title="Nouveau document"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        <FeedView library={library} onOpenSource={loadFromLibrary} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 md:px-8 py-8 md:py-16 selection:bg-sand-500/30 selection:text-sand-100">
      
      {/* Top Navbar */}
      {!isZenMode && (
        <nav className="w-full max-w-6xl flex justify-between items-center mb-16 animate-in slide-in-from-top-4 fade-in duration-700">
          <button 
            onClick={() => setAppState("upload")} 
            className="flex items-center gap-2 group"
          >
            <BookMarked className="w-6 h-6 text-sand-500 group-hover:rotate-12 transition-transform duration-300" />
            <span className="text-xl font-serif tracking-wide font-medium">Ilm.</span>
          </button>

          <div className="flex items-center gap-4">
            {currentUser ? (
               <button 
                 onClick={logout}
                 className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 hover:border-white/20 hover:bg-red-500/10 hover:text-red-400 transition-colors text-sm font-sans"
                 title="Se déconnecter"
               >
                 <LogOut className="w-4 h-4" />
                 <span className="hidden sm:inline">Déconnexion</span>
               </button>
            ) : (
               <button 
                 onClick={signInWithGoogle}
                 className="flex items-center gap-2 px-4 py-2 rounded-full border border-sand-500/30 text-sand-500 hover:bg-sand-500 hover:text-ink-900 transition-colors text-sm font-sans"
                 title="Se connecter pour sauvegarder dans le cloud"
               >
                 <LogIn className="w-4 h-4" />
                 <span className="hidden sm:inline">Connexion</span>
               </button>
            )}

            <button
              onClick={() => setAppState("feed")}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-sand-500/30 text-sand-500 hover:bg-sand-500 hover:text-ink-900 transition-colors text-sm font-sans"
              title="Feed de révision"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Feed</span>
            </button>

            {appState !== "library" && library.length > 0 && (
              <button
                onClick={() => setAppState("library")}
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors text-sm font-sans bg-white/5"
              >
                <Library className="w-4 h-4 text-sand-500" />
                Ma Bibliothèque
              </button>
            )}
            
            {appState === "library" && (
               <button 
                 onClick={() => setAppState("upload")}
                 className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors text-sm font-sans"
               >
                 <ArrowLeft className="w-4 h-4 text-sand-500" />
                 Nouveau Document
               </button>
            )}
          </div>
        </nav>
      )}

      <main className="w-full flex-1 flex flex-col">
        {appState === "upload" && (
          <div className="w-full flex-1 flex flex-col justify-center items-center gap-10 md:gap-12 -mt-16 md:-mt-24">
            <div className="text-center space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4 fade-in duration-700 delay-100">
              <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-serif text-sand-100 tracking-tight text-balance leading-tight max-w-4xl mx-auto">
                Synthétisez des connaissances<br className="hidden md:block" /> <span className="text-sand-500 italic pr-0 md:pr-2">profondes</span>.
              </h1>
              <p className="text-white/50 text-sm md:text-lg max-w-[18rem] sm:max-w-md md:max-w-lg mx-auto font-sans font-light text-balance leading-relaxed">
                Téléversez vos lectures. Nous en extrayons la philosophie, détaillons les concepts clés et structurons vos idées.
              </p>
            </div>
            
            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg px-6 py-4 animate-in fade-in max-w-2xl text-center font-sans text-sm">
                {errorMessage}
              </div>
            )}
            
            <FileUpload onUpload={handleUpload} />
          </div>
        )}

        {appState === "loading" && (
          <LoadingView
            current={batchProgress?.current}
            total={batchProgress?.total}
            fileName={batchProgress?.fileName}
          />
        )}

        {appState === "summary" && summaryData && (
          <SummaryView
            data={summaryData}
            isZenMode={isZenMode}
            setIsZenMode={setIsZenMode}
            loadSourceText={loadSourceText}
          />
        )}

        {appState === "library" && (
           <div className="w-full max-w-4xl mx-auto flex flex-col gap-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
             {errorMessage && (
               <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg px-6 py-4 animate-in fade-in text-center font-sans text-sm">
                 {errorMessage}
               </div>
             )}
             <header className="flex flex-col md:flex-row gap-6 md:items-end justify-between border-b border-white/10 pb-8">
               <div className="space-y-4">
                 <h1 className="text-4xl lg:text-5xl font-serif text-sand-100">Ma Bibliothèque</h1>
                 <p className="text-white/50">Vos connaissances accumulées et vos sessions de lecture.</p>
               </div>
               
               {library.length > 0 && (
                 <div className="flex flex-col gap-4 w-full md:w-auto mt-4 md:mt-0">
                   {/* Format Toggles & Search */}
                   <div className="flex flex-col md:flex-row gap-4 items-center justify-end">
                     <div className="flex bg-white/5 p-1 rounded-lg border border-white/10 shrink-0">
                       <button
                         onClick={() => setLibraryView("list")}
                         className={cn("px-4 py-1.5 rounded-md text-sm font-sans flex items-center gap-2 transition-colors", libraryView === "list" ? "bg-sand-500 text-ink-900 font-medium" : "text-white/50 hover:text-white/90")}
                       >
                         <List className="w-4 h-4" />
                         Liste
                       </button>
                       <button
                         onClick={() => setLibraryView("graph")}
                         className={cn("px-4 py-1.5 rounded-md text-sm font-sans flex items-center gap-2 transition-colors", libraryView === "graph" ? "bg-sand-500 text-ink-900 font-medium" : "text-white/50 hover:text-white/90")}
                       >
                         <Network className="w-4 h-4" />
                         Graphe
                       </button>
                     </div>
                     <div className="relative w-full md:w-64">
                       <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
                       <input
                         type="text"
                         placeholder="Rechercher..."
                         value={searchQuery}
                         onChange={(e) => setSearchQuery(e.target.value)}
                         className="bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-sand-500/50 transition-colors w-full"
                       />
                     </div>
                   </div>

                   {/* Semantic Filters */}
                   <div className="flex flex-wrap gap-3 items-center justify-end">
                     <div className="relative flex items-center gap-2">
                        <Tags className="w-4 h-4 text-white/30 absolute left-3" />
                        <select 
                          value={selectedTag} 
                          onChange={(e) => setSelectedTag(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-full py-1.5 pl-9 pr-8 text-xs text-white/70 appearance-none focus:outline-none focus:border-sand-500/50 cursor-pointer"
                        >
                          <option value="">Tous les tags</option>
                          {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                        </select>
                     </div>
                     <div className="relative flex items-center gap-2">
                        <UserCircle className="w-4 h-4 text-white/30 absolute left-3" />
                        <select 
                          value={selectedAuthor} 
                          onChange={(e) => setSelectedAuthor(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-full py-1.5 pl-9 pr-8 text-xs text-white/70 appearance-none focus:outline-none focus:border-sand-500/50 cursor-pointer"
                        >
                          <option value="">Tous les auteurs</option>
                          {allAuthors.map(author => <option key={author} value={author}>{author}</option>)}
                        </select>
                     </div>
                   </div>
                 </div>
               )}
             </header>

             {libraryView === "list" ? (
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {filteredLibrary.map((item) => (
                   <button 
                     key={item.id}
                     onClick={() => loadFromLibrary(item)}
                     className="text-left group flex flex-col gap-4 p-6 rounded-2xl bg-white/[0.02] border border-white/10 hover:border-sand-500/30 hover:bg-white/[0.04] transition-all duration-300"
                   >
                     <div className="px-2.5 py-1 w-fit bg-sand-500/10 text-sand-500 border border-sand-500/20 text-[10px] font-bold tracking-widest uppercase rounded-full">
                       {item.category}
                     </div>
                     <div>
                       <h3 className="text-2xl font-serif text-sand-100 mb-1 group-hover:text-sand-500 transition-colors">{item.title}</h3>
                       <p className="text-white/50 text-sm font-sans italic">par {item.author}</p>
                     </div>
                     <p className="text-white/70 text-sm leading-relaxed line-clamp-2 mt-auto">
                       {item.centralIdea}
                     </p>
                   </button>
                 ))}
                 
                 {library.length > 0 && filteredLibrary.length === 0 && (
                   <div className="col-span-full py-20 text-center border border-dashed border-white/10 rounded-2xl">
                     <p className="text-white/40 font-serif text-xl italic mb-4">Aucun résumé correspondant.</p>
                   </div>
                 )}

                 {library.length === 0 && (
                   <div className="col-span-full py-20 text-center border border-dashed border-white/10 rounded-2xl">
                     <p className="text-white/40 font-serif text-xl italic mb-4">Votre bibliothèque est vide.</p>
                     <button 
                       onClick={() => setAppState("upload")}
                       className="text-sand-500 hover:text-sand-300 underline underline-offset-4 text-sm"
                     >
                       Téléversez votre premier document
                     </button>
                   </div>
                 )}
               </div>
             ) : (
               <div className="w-full flex flex-col gap-4">
                 <p className="text-white/50 font-sans text-sm text-center">Découvrez les liens conceptuels entre vos lectures (basé sur les concepts extraits).</p>
                 <GraphView library={filteredLibrary} onNodeClick={loadFromLibrary} />
               </div>
             )}
           </div>
        )}
      </main>
    </div>
  );
}

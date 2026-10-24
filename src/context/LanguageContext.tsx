"use client";

import React, { createContext, useContext, useSyncExternalStore } from "react";
import { Language, translations } from "@/lib/translations";

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

let memoryLanguage: Language = "th";
let storageWriteFailed = false;
const languageEvent = "blu-language-change";

function languageSnapshot(): Language {
  if (storageWriteFailed) return memoryLanguage;
  try {
    const saved = localStorage.getItem("blu_lang");
    return saved === "en" || saved === "th" ? saved : "th";
  } catch {
    return memoryLanguage;
  }
}

function subscribeLanguage(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === "blu_lang" || event.key === null) {
          storageWriteFailed = false;
          notify();
        }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(languageEvent, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(languageEvent, notify);
  };
}

function setLang(newLang: Language) {
  memoryLanguage = newLang;
  try {
    localStorage.setItem("blu_lang", newLang);
    storageWriteFailed = false;
  } catch {
    storageWriteFailed = true;
    // Keep language switching available when browser storage is blocked.
  }
  window.dispatchEvent(new Event(languageEvent));
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const lang = useSyncExternalStore(subscribeLanguage, languageSnapshot, () => "th" as const);

  const toggleLang = () => {
    const nextLang = lang === "th" ? "en" : "th";
    setLang(nextLang);
  };

  const t = (key: string): string => {
    const dict = translations[lang] as Record<string, string>;
    if (dict && dict[key]) {
      return dict[key];
    }
    // Fallback to Thai
    const fallbackDict = translations.th as Record<string, string>;
    return fallbackDict[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}

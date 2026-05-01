"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import AIAssistant from "../components/AIAssistant";

type AIAssistantContextValue = {
  isOpen: boolean;
  openAssistant: () => void;
  closeAssistant: () => void;
};

const AIAssistantContext = createContext<AIAssistantContextValue | null>(null);

export function AIAssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openAssistant = useCallback(() => setIsOpen(true), []);
  const closeAssistant = useCallback(() => setIsOpen(false), []);
  const value = useMemo(
    () => ({
      isOpen,
      openAssistant,
      closeAssistant,
    }),
    [closeAssistant, isOpen, openAssistant],
  );

  return (
    <AIAssistantContext.Provider value={value}>
      {children}
      <AIAssistant />
    </AIAssistantContext.Provider>
  );
}

export function useAIAssistant() {
  const context = useContext(AIAssistantContext);

  if (!context) {
    throw new Error("useAIAssistant must be used within AIAssistantProvider");
  }

  return context;
}

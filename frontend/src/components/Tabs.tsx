import React, { useRef, useEffect } from "react";

export interface Tab {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: "underline" | "pill";
  ariaLabel: string;
}

export function Tabs({
  tabs,
  activeId,
  onChange,
  variant = "underline",
  ariaLabel,
}: TabsProps) {
  const tabRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const activeTabs = tabs.filter((t) => !t.disabled);
    const activeIndex = activeTabs.findIndex((t) => t.id === tabs[index].id);
    if (activeIndex === -1) return;

    let nextIndex: number | null = null;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (activeIndex + 1) % activeTabs.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (activeIndex - 1 + activeTabs.length) % activeTabs.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = activeTabs.length - 1;
    }

    if (nextIndex !== null) {
      const nextTab = activeTabs[nextIndex];
      onChange(nextTab.id);
      setTimeout(() => {
        tabRefs.current[nextTab.id]?.focus();
      }, 0);
    }
  };

  return (
    <div
      className={`gs-tabs gs-tabs--${variant}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            role="tab"
            aria-selected={isActive ? "true" : "false"}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`gs-tab${isActive ? " gs-tab--active" : ""}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps {
  id: string;
  activeId: string;
  children: React.ReactNode;
}

export function TabPanel({ id, activeId, children }: TabPanelProps) {
  const isActive = id === activeId;
  if (!isActive) return null;

  return (
    <div
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className="gs-tabpanel"
    >
      {children}
    </div>
  );
}

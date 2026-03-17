import React, { createContext, useContext, useState, useCallback } from 'react';
import type { PanelContent } from '../components/sidebar/RightPanel';

interface DrawerContextValue {
  isOpen: boolean;
  content: PanelContent | null;
  openDrawer: (content: PanelContent) => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

const DrawerContext = createContext<DrawerContextValue | undefined>(undefined);

export const DrawerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState<PanelContent | null>(null);

  const openDrawer = useCallback((newContent: PanelContent) => {
    setContent(newContent);
    setIsOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    // 不立即清空内容，保留最后显示的内容
  }, []);

  const toggleDrawer = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  return (
    <DrawerContext.Provider value={{ isOpen, content, openDrawer, closeDrawer, toggleDrawer }}>
      {children}
    </DrawerContext.Provider>
  );
};

export const useDrawer = () => {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error('useDrawer must be used within DrawerProvider');
  }
  return context;
};

/**
 * Drawer Context - 右侧面板抽屉状态管理
 */

'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { PanelContent } from '../components/sidebar/RightPanel'

interface DrawerContextType {
  isOpen: boolean
  content: PanelContent | null
  openDrawer: (content: PanelContent) => void
  closeDrawer: () => void
}

const DrawerContext = createContext<DrawerContextType | undefined>(undefined)

interface DrawerProviderProps {
  children: ReactNode
}

export function DrawerProvider({ children }: DrawerProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState<PanelContent | null>(null)

  const openDrawer = (newContent: PanelContent) => {
    setContent(newContent)
    setIsOpen(true)
  }

  const closeDrawer = () => {
    setIsOpen(false)
    // 延迟清除内容，等待动画完成
    setTimeout(() => setContent(null), 300)
  }

  return (
    <DrawerContext.Provider value={{ isOpen, content, openDrawer, closeDrawer }}>
      {children}
    </DrawerContext.Provider>
  )
}

export function useDrawer() {
  const context = useContext(DrawerContext)
  if (context === undefined) {
    throw new Error('useDrawer must be used within a DrawerProvider')
  }
  return context
}

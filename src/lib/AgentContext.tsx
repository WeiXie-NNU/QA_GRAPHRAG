/**
 * Agent 状态管理 Context
 * 
 * 参考: https://github.com/CopilotKit/open-research-ANA/blob/main/frontend/src/components/research-context.tsx
 * 
 * 关键点:
 * 1. useCoAgent 只在这里调用一次
 * 2. 通过 Context 共享状态给所有子组件
 * 3. useCoAgentStateRender 在使用状态的组件中调用
 */

'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useCoAgent } from "@copilotkit/react-core"
import type { TestAgentState } from '../lib/types'

// ============================================================
// Context 类型定义
// ============================================================

interface AgentContextType {
  /** Agent 状态 */
  state: TestAgentState
  /** 设置状态 */
  setState: (newState: TestAgentState | ((prevState: TestAgentState) => TestAgentState)) => void
  /** 是否正在运行 */
  running: boolean
  /** 手动触发 agent 运行 */
  run: () => void
}

const AgentContext = createContext<AgentContextType | undefined>(undefined)

// ============================================================
// Provider 组件
// ============================================================

interface AgentProviderProps {
  children: ReactNode
  agentName: string
}

/**
 * Agent 状态 Provider
 * 
 * 必须在 CopilotKit 内部使用
 */
export function AgentProvider({ children, agentName }: AgentProviderProps) {
  // 唯一的 useCoAgent 调用点
  // 只同步 steps 用于进度条，geo_points 通过 API 按需获取
  const { state, setState, running, run } = useCoAgent<TestAgentState>({
    name: agentName,
    initialState: {
      steps: [],
    },
  })

  return (
    <AgentContext.Provider value={{ 
      state: state || { steps: [] }, 
      setState: setState as AgentContextType['setState'], 
      running, 
      run 
    }}>
      {children}
    </AgentContext.Provider>
  )
}

// ============================================================
// Hook
// ============================================================

/**
 * 获取 Agent 状态的 Hook
 * 
 * 必须在 AgentProvider 内部使用
 */
export function useAgent() {
  const context = useContext(AgentContext)
  if (context === undefined) {
    throw new Error('useAgent must be used within an AgentProvider')
  }
  return context
}

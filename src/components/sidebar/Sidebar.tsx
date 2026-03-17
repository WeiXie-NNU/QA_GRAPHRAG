/**
 * 侧边栏组件
 * 
 * 包含线程管理、智能体选择等功能
 */

import React, { useState, useCallback, useEffect, useMemo, useRef, memo } from "react";
import type { AppUser } from "../../services/authService";
import type { ThreadMeta } from "../../services/threadService";
import "./Sidebar.css";

// ============================================================
// 类型定义
// ============================================================

interface SidebarProps {
  /** 是否展开 */
  isOpen: boolean;
  /** 切换展开状态 */
  onToggle: () => void;
  /** 当前线程 ID */
  currentThreadId: string;
  /** 线程列表 */
  threads: ThreadMeta[];
  /** 当前用户 */
  currentUser: AppUser;
  /** 所有用户 */
  users: AppUser[];
  /** 创建新对话 */
  onNewChat: () => void;
  /** 切换线程 */
  onSwitchThread: (threadId: string) => void;
  /** 切换用户 */
  onSwitchUser: (userId: string) => void;
  /** 退出登录 */
  onLogout: () => void;
  /** 删除线程 */
  onDeleteThread: (threadId: string) => void;
  /** 重命名线程 */
  onRenameThread: (threadId: string, newName: string) => void;
  /** 初始加载中 */
  isLoadingThreads?: boolean;
  /** 加载更多中 */
  isLoadingMoreThreads?: boolean;
  /** 是否还有更多线程 */
  hasMoreThreads?: boolean;
  /** 加载更多线程 */
  onLoadMoreThreads?: () => void;
}

// ============================================================
// 线程列表项组件
// ============================================================

interface ThreadItemProps {
  thread: ThreadMeta;
  isActive: boolean;
  isEditing: boolean;
  editingName: string;
  onSelect: () => void;
  onStartRename: () => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onEditingNameChange: (name: string) => void;
  onDelete: () => void;
}

const ThreadItem: React.FC<ThreadItemProps> = memo(({
  thread,
  isActive,
  isEditing,
  editingName,
  onSelect,
  onStartRename,
  onFinishRename,
  onCancelRename,
  onEditingNameChange,
  onDelete,
}) => (
  <div
    className={`thread-item ${isActive ? "active" : ""}`}
    onClick={onSelect}
  >
    <div className="thread-content">
      {isEditing ? (
        <input
          className="thread-name-input"
          value={editingName}
          onChange={(e) => onEditingNameChange(e.target.value)}
          onBlur={onFinishRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onFinishRename();
            if (e.key === "Escape") onCancelRename();
          }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="thread-name">{thread.name}</span>
      )}
    </div>
    <div className="thread-actions">
      {!isEditing && (
        <button
          className="thread-edit"
          onClick={(e) => {
            e.stopPropagation();
            onStartRename();
          }}
          title="重命名"
        >
          ✏️
        </button>
      )}
      <button
        className="thread-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="删除对话"
      >
        🗑️
      </button>
    </div>
  </div>
));

// ============================================================
// 主组件
// ============================================================

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onToggle,
  currentThreadId,
  threads,
  currentUser,
  users,
  onNewChat,
  onSwitchThread,
  onSwitchUser,
  onLogout,
  onDeleteThread,
  onRenameThread,
  isLoadingThreads = false,
  isLoadingMoreThreads = false,
  hasMoreThreads = false,
  onLoadMoreThreads,
}) => {
  // 编辑状态
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const otherUsers = useMemo(
    () => users.filter((user) => user.id !== currentUser.id),
    [currentUser.id, users],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  // 开始重命名
  const handleStartRename = useCallback((thread: ThreadMeta) => {
    setEditingThreadId(thread.id);
    setEditingName(thread.name);
  }, []);

  // 完成重命名
  const handleFinishRename = useCallback(() => {
    if (editingThreadId && editingName.trim()) {
      onRenameThread(editingThreadId, editingName.trim());
    }
    setEditingThreadId(null);
    setEditingName("");
  }, [editingThreadId, editingName, onRenameThread]);

  // 取消重命名
  const handleCancelRename = useCallback(() => {
    setEditingThreadId(null);
    setEditingName("");
  }, []);

  // 线程列表已由父组件过滤，直接使用 threads
  // （之前的 filteredThreads 是冗余的）

  return (
    <>
      {/* 侧边栏 */}
      <aside className={`sidebar ${isOpen ? "open" : "closed"}`}>
        {/* 标题栏 */}
        <div className="sidebar-header">
          {/* 折叠按钮 - 放在左侧，参考ChatGPT */}
          <button
            className="sidebar-toggle"
            onClick={onToggle}
            title={isOpen ? "折叠侧边栏" : "展开侧边栏"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
          <span className="sidebar-title">GraphRAG</span>
        </div>

        {/* 内容区域 - 对话列表 */}
        <div className="sidebar-content">
          {/* 对话列表 */}
          <div className="thread-list">
            <h3>💬 历史对话</h3>
            {isLoadingThreads && threads.length === 0 ? (
              <p className="no-threads">加载历史对话中...</p>
            ) : threads.length === 0 ? (
              <p className="no-threads">暂无历史对话</p>
            ) : (
              <>
                {threads.map((thread) => (
                  <ThreadItem
                    key={thread.id}
                    thread={thread}
                    isActive={thread.id === currentThreadId}
                    isEditing={editingThreadId === thread.id}
                    editingName={editingName}
                    onSelect={() => onSwitchThread(thread.id)}
                    onStartRename={() => handleStartRename(thread)}
                    onFinishRename={handleFinishRename}
                    onCancelRename={handleCancelRename}
                    onEditingNameChange={setEditingName}
                    onDelete={() => onDeleteThread(thread.id)}
                  />
                ))}

                {(hasMoreThreads || isLoadingMoreThreads) && (
                  <button
                    type="button"
                    className="thread-load-more"
                    onClick={onLoadMoreThreads}
                    disabled={isLoadingMoreThreads}
                  >
                    {isLoadingMoreThreads ? "加载中..." : "加载更多"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* 底部操作区域 - 统一样式 */}
        <div className="sidebar-footer">
          {/* 新建对话 */}
          <button className="sidebar-action-item" onClick={onNewChat} title="新建对话">
            <div className="action-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </div>
            <span className="action-label">新建对话</span>
          </button>

          {/* 知识图谱 */}
          <a 
            href="/graph" 
            target="_blank" 
            rel="noopener noreferrer"
            className="sidebar-action-item"
            title="查看知识图谱"
          >
            <div className="action-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <circle cx="19" cy="5" r="2"/>
                <circle cx="5" cy="19" r="2"/>
                <circle cx="5" cy="5" r="2"/>
                <circle cx="19" cy="19" r="2"/>
                <line x1="12" y1="9" x2="12" y2="5"/>
                <line x1="9.5" y1="13.5" x2="6" y2="17"/>
                <line x1="14.5" y1="10.5" x2="18" y2="7"/>
              </svg>
            </div>
            <span className="action-label">知识图谱</span>
          </a>

          {/* 用户头像 */}
          <div className="user-menu-wrap" ref={userMenuRef}>
            <button
              type="button"
              className="sidebar-action-item user-item"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              title="账号设置"
            >
              <div
                className="action-icon user-avatar"
                style={{ backgroundColor: currentUser.avatarColor }}
              >
                <span>{currentUser.name.slice(0, 1).toUpperCase()}</span>
              </div>
              <span className="action-label">{currentUser.name}</span>
            </button>

            {isUserMenuOpen && (
              <div className="user-menu-panel">
                <div className="user-menu-section">
                  <p className="user-menu-title">当前账号</p>
                  <div className="user-menu-current">
                    <span
                      className="user-menu-current-avatar"
                      style={{ backgroundColor: currentUser.avatarColor }}
                    >
                      {currentUser.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="user-menu-current-meta">
                      <strong>{currentUser.name}</strong>
                      <small>{currentUser.id}</small>
                    </div>
                  </div>
                </div>

                <div className="user-menu-section">
                  <p className="user-menu-title">切换账号</p>
                  {otherUsers.length > 0 ? (
                    otherUsers.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="user-menu-item"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onSwitchUser(user.id);
                        }}
                      >
                        <span
                          className="user-menu-item-avatar"
                          style={{ backgroundColor: user.avatarColor }}
                        >
                          {user.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="user-menu-item-label">{user.name}</span>
                      </button>
                    ))
                  ) : (
                    <p className="user-menu-empty">暂无其他账号</p>
                  )}
                </div>

                <button
                  type="button"
                  className="user-menu-item danger"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    onLogout();
                  }}
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;

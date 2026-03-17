import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import "./LoginPage.css";
import { useAuth } from "../contexts";
import { DEFAULT_LOGIN_SUGGESTIONS } from "../services/authService";

interface LoginLocationState {
  from?: string;
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { users, login } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const targetPath = (location.state as LoginLocationState | null)?.from || "/";
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const names = [...users.map((user) => user.name), ...DEFAULT_LOGIN_SUGGESTIONS];
    return names.filter((item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [users]);

  const handleLogin = (value: string) => {
    const nextName = value.trim();
    if (!nextName) {
      setError("请输入用户名");
      return;
    }

    try {
      login(nextName);
      navigate(targetPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-copy">
          <p className="login-eyebrow">MULTI USER ACCESS</p>
          <h1>登录 GraphRAG 工作台</h1>
          <p>
            这里采用最简账号方案: 输入用户名即可登录，同一用户名会自动回到自己的历史会话。
          </p>
        </div>

        <div className="login-form">
          <label className="login-label" htmlFor="login-name">
            用户名
          </label>
          <input
            id="login-name"
            className="login-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleLogin(name);
              }
            }}
            placeholder="例如: Demo / Alice / 数据分析师"
            autoFocus
          />

          {error ? <p className="login-error">{error}</p> : null}

          <button type="button" className="login-submit" onClick={() => handleLogin(name)}>
            登录并进入系统
          </button>
        </div>

        <div className="login-suggestions">
          <p className="login-section-title">快捷登录</p>
          <div className="login-chip-list">
            {suggestions.map((item) => (
              <button
                key={item}
                type="button"
                className="login-chip"
                onClick={() => handleLogin(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {users.length > 0 ? (
          <div className="login-users">
            <p className="login-section-title">最近账号</p>
            <div className="login-user-list">
              {users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="login-user-card"
                  onClick={() => handleLogin(user.name)}
                >
                  <span
                    className="login-user-avatar"
                    style={{ backgroundColor: user.avatarColor }}
                  >
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="login-user-meta">
                    <strong>{user.name}</strong>
                    <small>{user.id}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

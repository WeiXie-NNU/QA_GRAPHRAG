/**
 * 欢迎界面组件
 * 
 * 在新对话创建时显示，提供简洁的欢迎信息
 */

import React from "react";
import "./WelcomeScreen.css";

interface WelcomeScreenProps {
  /** 是否显示 */
  visible: boolean;
  variant?: "overlay" | "inline";
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ visible, variant = "overlay" }) => {
  if (!visible) return null;

  return (
    <div className={`welcome-screen ${variant === "inline" ? "inline" : ""}`}>
      <div className="welcome-content">
        <h1 className="welcome-title">
          <span className="welcome-line-1">
            生态遥感模型智能问答平台已就绪
          </span>
          <br />
          <span className="welcome-line-2">
            您可以开始提问任何问题
          </span>
        </h1>
      </div>
    </div>
  );
};

export default WelcomeScreen;

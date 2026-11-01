import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

/*
 * 兜底渲染错误。
 *
 * 地图和粒子特效是最容易出意外的两块第三方代码，一次渲染异常不该让整页
 * 变白。播放引擎是模块级单例，Audio 不挂在这棵 React 树上，所以兜底出现
 * 时声音通常还在，文案也照这个说。
 */

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("界面渲染失败", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-base px-6 text-center">
        <div className="max-w-sm">
          <p className="text-[13px] text-muted">界面出了点问题，电台应该还在播。</p>
          <p className="mt-1 text-[12px] text-dim">可以重试一次，或者刷新页面。</p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => this.setState({ failed: false })}
              className="h-9 rounded-[10px] border border-line px-4 text-[12px] text-muted transition-colors hover:text-ink"
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-9 rounded-[10px] border border-line px-4 text-[12px] text-muted transition-colors hover:text-ink"
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}

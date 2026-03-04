// Type shims for blessed modules that have incomplete typings

declare module 'blessed' {
  interface BlessedElement {
    show(): void;
    hide(): void;
    destroy(): void;
    focus(): void;
    setContent(content: string): void;
    setItems(items: string[]): void;
    select(index: number): void;
    getValue(): string;
    clearValue(): void;
    scrollTo(pos: number): void;
    key(keys: string | string[], cb: (...args: any[]) => void): void;
    on(event: string, cb: (...args: any[]) => void): void;
    append(child: BlessedElement): void;
    focused: boolean;
  }
}

export {};

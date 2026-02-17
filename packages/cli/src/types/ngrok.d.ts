/**
 * Minimal type declarations for @ngrok/ngrok (optional dependency).
 * Only the methods used by the tunnel command are declared.
 */
declare module '@ngrok/ngrok' {
  interface Listener {
    url(): string | undefined;
    close(): Promise<void>;
  }

  interface ForwardOptions {
    addr: number | string;
    authtoken_from_env?: boolean;
  }

  export function authtoken(token: string): Promise<void>;
  export function forward(options: ForwardOptions): Promise<Listener>;
  export function disconnect(): Promise<void>;
}

// "Sign in with Google" button (Google Identity Services), shared by /login and /register.
// The button only appears when the server has GOOGLE_CLIENT_ID configured (GET /auth/config).
import { getAuthConfig, loginWithGoogle } from './api';
import type { User } from '@gametuoitho/shared-types';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

declare global {
  interface Window {
    google?: any;
  }
}

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`);
    const script = existing || document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Không tải được Google Sign-In')), { once: true });
    if (!existing) {
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Show the Google button inside `block` (its child `[data-google-button]` receives the button).
 * Returns false when Google sign-in is not enabled or Google's script cannot load — the block stays hidden.
 */
export async function mountGoogleSignIn(options: {
  block: HTMLElement;
  text: 'signin_with' | 'signup_with' | 'continue_with';
  onSuccess: (user: User) => void;
  onError: (message: string) => void;
}): Promise<boolean> {
  const config = await getAuthConfig();
  const clientId = config.success ? config.data?.googleClientId : null;
  if (!clientId) return false;

  try {
    await loadGoogleScript();
  } catch {
    return false;
  }

  const target = options.block.querySelector<HTMLElement>('[data-google-button]');
  if (!target || !window.google?.accounts?.id) return false;

  options.block.classList.remove('hidden');
  window.google.accounts.id.initialize({
    client_id: clientId,
    ux_mode: 'popup',
    auto_select: false,
    cancel_on_tap_outside: true,
    callback: async (response: { credential?: string }) => {
      if (!response?.credential) {
        options.onError('Không nhận được thông tin đăng nhập từ Google.');
        return;
      }
      const res = await loginWithGoogle(response.credential);
      if (res.success && res.data?.user) options.onSuccess(res.data.user);
      else options.onError(res.error?.message || 'Đăng nhập Google thất bại.');
    },
  });
  window.google.accounts.id.renderButton(target, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: options.text,
    logo_alignment: 'left',
    locale: 'vi',
    width: Math.min(400, Math.max(220, Math.floor(target.clientWidth || 320))),
  });
  return true;
}

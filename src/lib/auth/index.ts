import SyncEngine from "@/lib/sync/engine";
import { setClientId, setSessionExpiry } from "@/lib/sync/meta";

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30 - 1000 * 60; // 30 days with leeway

type LoginResponse =
  | {
      success: true;
    }
  | {
      success: false;
      message: string;
      isTempUser: boolean;
    };

const UNAUTHORIZED_MESSAGE = "Invalid email or password";
const UNKNOWN_ERROR_MESSAGE = "An unknown error occurred";

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const response = await fetch(
    `${import.meta.env.VITE_BACKEND_URL}/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    },
  );

  if (response.status === 401) {
    const data = (await response.json()) as {
      success: false;
      isTempUser?: boolean;
    };

    return {
      success: false,
      message: UNAUTHORIZED_MESSAGE,
      isTempUser: data.isTempUser ?? false,
    };
  }

  if (!response.ok) {
    return {
      success: false,
      message: UNKNOWN_ERROR_MESSAGE,
      isTempUser: false,
    };
  }

  const now = new Date();
  const sessionExpiry = new Date(now.getTime() + SESSION_DURATION_MS);
  await setSessionExpiry(sessionExpiry);

  return {
    success: true,
  };
}

type RegisterResponse = {
  success: boolean;
  message?: string;
};

export async function register(
  email: string,
  password: string,
): Promise<RegisterResponse> {
  const response = await fetch(
    `${import.meta.env.VITE_BACKEND_URL}/auth/register`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    },
  );

  if (!response.ok) {
    return {
      success: false,
      message: UNKNOWN_ERROR_MESSAGE,
    };
  }

  const data = (await response.json()) as {
    success: boolean;
    error?: string;
  };

  if (data.success) {
    const now = new Date();
    const sessionExpiry = new Date(now.getTime() + SESSION_DURATION_MS);
    await setSessionExpiry(sessionExpiry);
  }

  return {
    success: data.success,
    message: data.error,
  };
}

type VerifyOtpResponse = {
  success: boolean;
  message?: string;
};

export async function verifyOtp(
  email: string,
  pin: string,
): Promise<VerifyOtpResponse> {
  const response = await fetch(
    `${import.meta.env.VITE_BACKEND_URL}/auth/verify`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, token: pin }),
      credentials: "include",
    },
  );

  if (!response.ok) {
    return {
      success: false,
      message: UNKNOWN_ERROR_MESSAGE,
    };
  }

  const data: { success: true } | { success: false; error: string } =
    await response.json();
  if (!data.success) {
    return {
      success: false,
      message: data.error,
    };
  }

  await setSessionExpiry(new Date(Date.now() + SESSION_DURATION_MS));

  return {
    success: data.success,
  };
}

type RegisterClientResponse = {
  success: boolean;
  message?: string;
};

export async function registerClient(): Promise<RegisterClientResponse> {
  const response = await fetch(
    `${import.meta.env.VITE_BACKEND_URL}/auth/clientId`,
    {
      method: "POST",
      credentials: "include",
    },
  );

  if (!response.ok) {
    console.error("Failed to register client", response);
    return {
      success: false,
      message: UNKNOWN_ERROR_MESSAGE,
    };
  }

  const data: { clientId: string } = await response.json();
  await setClientId(data.clientId);

  return {
    success: true,
  };
}

export async function registerAndSync(clientId?: string): Promise<void> {
  if (clientId) {
    await setClientId(clientId);
    return SyncEngine.syncFromServer();
  }

  const clientIdResponse = await registerClient();
  if (!clientIdResponse.success) {
    throw new Error(clientIdResponse.message);
  }

  return SyncEngine.syncFromServer();
}

type LogoutResponse = {
  success: boolean;
  message?: string;
};

export async function logout(): Promise<LogoutResponse> {
  const response = await fetch(
    `${import.meta.env.VITE_BACKEND_URL}/auth/logout`,
    {
      method: "POST",
      credentials: "include",
    },
  );

  if (!response.ok) {
    console.error("Failed to logout", response);
    return {
      success: false,
      message: UNKNOWN_ERROR_MESSAGE,
    };
  }

  return {
    success: true,
  };
}

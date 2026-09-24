export default {
  async fetch(request: Request) {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "https://spaced2.zsheng.app",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Client-Id, X-Device-ID",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    };
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    return new Response(
      JSON.stringify({
        success: false,
        error:
          "This version of Spaced has been retired. Reload https://spaced2.zsheng.app and sign in again.",
      }),
      { status: 410, headers },
    );
  },
};

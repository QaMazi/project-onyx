const ADMIN_DISCORD_ID = "475880707403546644";

(function initAuth() {
  function getClient() {
    if (!window.db || !window.db.supabase) {
      console.error("Supabase client is not available on window.db.supabase.");
      return null;
    }
    return window.db.supabase;
  }

  window.ggAuth = {
    ADMIN_DISCORD_ID,

    async signInWithDiscord() {
      const client = getClient();
      if (!client) {
        alert("Login system is not ready yet.");
        return;
      }

      const { error } = await client.auth.signInWithOAuth({
        provider: "discord",
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });

      if (error) {
        console.error("Discord login error:", error.message);
        alert("Discord login failed.");
      }
    },

    async signOut() {
      const client = getClient();
      if (!client) return;

      const { error } = await client.auth.signOut();
      if (error) {
        console.error("Sign out error:", error.message);
        return;
      }

      window.location.reload();
    },

    async getSession() {
      const client = getClient();
      if (!client) return null;

      const { data, error } = await client.auth.getSession();

      if (error) {
        console.error("Get session error:", error.message);
        return null;
      }

      return data.session;
    },

    async ensureUserRecord(session) {
      const client = getClient();
      if (!client || !session || !session.user) return null;

      const user = session.user;

      const discordId =
        user.user_metadata?.provider_id ||
        user.user_metadata?.sub ||
        user.id;

      const username =
        user.user_metadata?.preferred_username ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.user_metadata?.user_name ||
        user.email ||
        "Unknown User";

      const avatar =
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture ||
        "";

      const role =
        String(discordId) === String(ADMIN_DISCORD_ID) ? "admin" : "player";

      const payload = {
        auth_user_id: user.id,
        discord_id: String(discordId),
        username,
        avatar,
        role
      };

      const { data, error } = await client
        .from("users")
        .upsert(payload, { onConflict: "discord_id" })
        .select()
        .single();

      if (error) {
        console.error("Failed to create/update user:", error.message);
        return null;
      }

      return data;
    }
  };
})();
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import ProgressionPanelShell from "./ProgressionPanelShell";
import ProgressionNotesModal from "./ProgressionNotesModal";

const PLAYER_MENU_ITEMS = [
  { label: "Ready Up", primary: true },
  { label: "Deck" },
  { label: "Binder" },
  { label: "Inventory" },
  { label: "Trade" },
  { label: "Store" },
  { label: "Notes" },
  { label: "Opener" },
];

function ProgressionPlayerMenuPanel() {
  const navigate = useNavigate();
  const { user } = useUser();

  const [hasTradeNotification, setHasTradeNotification] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadTradeNotifications() {
      if (!user?.id) {
        if (isMounted) {
          setHasTradeNotification(false);
        }
        return;
      }

      try {
        const [
          { count: pendingTradeCount, error: tradeError },
          { count: unreadGiftCount, error: giftError },
        ] = await Promise.all([
          supabase
            .from("player_trades")
            .select("id", { count: "exact", head: true })
            .eq("offered_to_user_id", user.id)
            .eq("status", "pending"),

          supabase
            .from("player_gifts")
            .select("id", { count: "exact", head: true })
            .eq("sent_to_user_id", user.id)
            .eq("is_read", false),
        ]);

        if (tradeError) {
          throw tradeError;
        }

        if (giftError) {
          throw giftError;
        }

        if (isMounted) {
          setHasTradeNotification(
            (pendingTradeCount || 0) > 0 || (unreadGiftCount || 0) > 0
          );
        }
      } catch (error) {
        console.error("Failed to load trade notifications:", error);
        if (isMounted) {
          setHasTradeNotification(false);
        }
      }
    }

    loadTradeNotifications();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  function handlePlayerMenuClick(itemLabel) {
    if (itemLabel === "Binder") {
      navigate("/mode/progression/binder");
      return;
    }

    if (itemLabel === "Deck") {
      navigate("/mode/progression/deck");
      return;
    }

    if (itemLabel === "Inventory") {
      navigate("/mode/progression/inventory");
      return;
    }

    if (itemLabel === "Trade") {
      navigate("/mode/progression/trade");
      return;
    }

    if (itemLabel === "Store") {
      navigate("/mode/progression/store");
      return;
    }

    if (itemLabel === "Notes") {
      setNotesOpen(true);
      return;
    }

    if (itemLabel === "Back To Mode Select") {
      navigate("/mode");
    }
  }

  return (
    <>
      <ProgressionPanelShell
        kicker="PLAYER"
        title="Player Menu"
        meta={<span>{PLAYER_MENU_ITEMS.length} Actions</span>}
        className="progression-panel-fill"
      >
        <div className="progression-player-menu-layout">
          <div className="progression-action-grid progression-player-menu-grid">
            {PLAYER_MENU_ITEMS.map((item) => {
              const isTradeButton = item.label === "Trade";

              return (
                <button
                  key={item.label}
                  type="button"
                  className={`progression-action-btn progression-player-menu-btn ${
                    item.primary ? "progression-action-btn-primary" : ""
                  }`}
                  onClick={() => handlePlayerMenuClick(item.label)}
                >
                  {item.label}
                  {isTradeButton && hasTradeNotification ? (
                    <span className="trade-notification-dot" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="progression-player-menu-footer">
            <button
              type="button"
              className="progression-action-btn progression-player-menu-btn progression-player-menu-back-btn"
              onClick={() => handlePlayerMenuClick("Back To Mode Select")}
            >
              Back To Mode Select
            </button>
          </div>
        </div>
      </ProgressionPanelShell>

      <ProgressionNotesModal
        isOpen={notesOpen}
        onClose={() => setNotesOpen(false)}
      />
    </>
  );
}

export default ProgressionPlayerMenuPanel;
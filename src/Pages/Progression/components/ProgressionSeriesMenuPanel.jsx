import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { useProgression } from "../../../context/ProgressionContext";
import ProgressionPanelShell from "./ProgressionPanelShell";

const SERIES_MENU_ITEMS = [
  { label: "Banlist" },
  { label: "Phases & Rules" },
  { label: "Card Database" },
  { label: "Pack Database" },
  { label: "Deck Box Database" },
  { label: "Promo Box Database" },
  { label: "Collectors Box Database" },
];

const PHASE_RULE_SECTIONS = [
  {
    title: "Lobby",
    bullets: [
      "Admin setup phase before players can use progression systems.",
      "Players stay locked to the progression hub until an admin advances into Round 0.",
    ],
  },
  {
    title: "Standby Phase",
    bullets: [
      "Store, inventory, trade, binder, and container systems are available.",
      "Active deck switching and active deck edits stay locked.",
    ],
  },
  {
    title: "Deckbuilding Phase",
    bullets: [
      "This is the only normal phase where the active deck can be switched and edited.",
      "Ready Up locks in your status for the phase.",
    ],
  },
  {
    title: "Dueling Phase",
    bullets: [
      "The bracket controls who is active, waiting, or done.",
      "Active deck cards are protected for the round snapshot.",
    ],
  },
  {
    title: "Reward Phase",
    bullets: [
      "Rewards are processed by the system.",
      "If reward errors happen, admins must clear the fix list before advancing.",
    ],
  },
  {
    title: "Round 0",
    bullets: [
      "Begins when an admin advances out of Lobby.",
      "The starter-deck claim modal stays up until you claim, then remains until every player has claimed one.",
    ],
  },
];

function SeriesInfoModal({ kicker, title, onClose, children }) {
  return (
    <div className="progression-results-modal-overlay">
      <div className="progression-results-modal progression-series-info-modal">
        <div className="progression-results-modal-header">
          <div>
            <div className="progression-results-modal-kicker">{kicker}</div>
            <h2 className="progression-results-modal-title">{title}</h2>
          </div>

          <button
            type="button"
            className="progression-results-modal-close-btn"
            onClick={onClose}
          >
            x
          </button>
        </div>

        <div className="progression-results-modal-body">{children}</div>
      </div>
    </div>
  );
}

function getGroupedBanlistRows(rows) {
  return {
    forbidden: rows.filter((row) => row.status === "forbidden"),
    limited: rows.filter((row) => row.status === "limited"),
    semiLimited: rows.filter((row) => row.status === "semi_limited"),
    unlimited: rows.filter((row) => row.status === "unlimited"),
  };
}

function ProgressionSeriesMenuPanel() {
  const navigate = useNavigate();
  const { activeSeriesId } = useProgression();
  const [openModal, setOpenModal] = useState(null);
  const [banlistRows, setBanlistRows] = useState([]);
  const [banlistLoading, setBanlistLoading] = useState(false);
  const [banlistError, setBanlistError] = useState("");
  const [activeSeriesName, setActiveSeriesName] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadBanlistModal() {
      if (openModal !== "banlist") return;
      if (!activeSeriesId) {
        setBanlistRows([]);
        setBanlistError("No active series found.");
        setActiveSeriesName("");
        return;
      }

      setBanlistLoading(true);
      setBanlistError("");

      try {
        const { data: seriesRow, error: seriesError } = await supabase
          .from("game_series")
          .select("name")
          .eq("id", activeSeriesId)
          .maybeSingle();

        if (seriesError) throw seriesError;

        const { data: rawRows, error: rowsError } = await supabase
          .from("series_banlist_cards")
          .select("card_id, status")
          .eq("series_id", activeSeriesId)
          .order("card_id", { ascending: true });

        if (rowsError) throw rowsError;

        const cardIds = [...new Set((rawRows || []).map((row) => Number(row.card_id)).filter(Boolean))];
        let cardMap = new Map();

        if (cardIds.length > 0) {
          const { data: cardsData, error: cardsError } = await supabase
            .from("cards")
            .select("id, name")
            .in("id", cardIds);

          if (cardsError) throw cardsError;
          cardMap = new Map((cardsData || []).map((card) => [Number(card.id), card.name]));
        }

        const hydratedRows = (rawRows || [])
          .map((row) => ({
            ...row,
            card_name: cardMap.get(Number(row.card_id)) || `Card ${row.card_id}`,
          }))
          .sort((left, right) => {
            const nameCompare = String(left.card_name).localeCompare(String(right.card_name));
            if (nameCompare !== 0) return nameCompare;
            return Number(left.card_id) - Number(right.card_id);
          });

        if (!cancelled) {
          setActiveSeriesName(seriesRow?.name || "Active Series");
          setBanlistRows(hydratedRows);
        }
      } catch (error) {
        console.error("Failed to load series banlist modal:", error);
        if (!cancelled) {
          setBanlistRows([]);
          setBanlistError(error.message || "Failed to load the banlist.");
        }
      } finally {
        if (!cancelled) {
          setBanlistLoading(false);
        }
      }
    }

    loadBanlistModal();

    return () => {
      cancelled = true;
    };
  }, [activeSeriesId, openModal]);

  const groupedBanlistRows = useMemo(
    () => getGroupedBanlistRows(banlistRows),
    [banlistRows]
  );

  function handleSeriesMenuClick(label) {
    if (label === "Banlist") {
      setOpenModal("banlist");
      return;
    }

    if (label === "Card Database") {
      navigate("/mode/progression/cards");
      return;
    }

    if (label === "Phases & Rules") {
      setOpenModal("phases");
      return;
    }

    if (label === "Pack Database") {
      navigate("/mode/progression/containers/packs");
      return;
    }

    if (label === "Deck Box Database") {
      navigate("/mode/progression/containers/deck-boxes");
      return;
    }

    if (label === "Promo Box Database") {
      navigate("/mode/progression/containers/promo-boxes");
      return;
    }

    if (label === "Collectors Box Database") {
      navigate("/mode/progression/containers/collectors-boxes");
    }
  }

  return (
    <>
      <ProgressionPanelShell
        kicker="SERIES"
        title="Series Menu"
        meta={<span>{SERIES_MENU_ITEMS.length} Links</span>}
        className="progression-panel-fill"
      >
        <div className="progression-action-grid progression-action-grid-series">
          {SERIES_MENU_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              className="progression-action-btn"
              onClick={() => handleSeriesMenuClick(item.label)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </ProgressionPanelShell>

      {openModal === "phases" ? (
        <SeriesInfoModal
          kicker="SERIES"
          title="Phases & Rules"
          onClose={() => setOpenModal(null)}
        >
          <div className="progression-series-rules-grid">
            {PHASE_RULE_SECTIONS.map((section) => (
              <section className="progression-series-rules-card" key={section.title}>
                <h3 className="progression-series-rules-title">{section.title}</h3>
                <div className="progression-series-rules-list">
                  {section.bullets.map((bullet) => (
                    <div
                      key={`${section.title}-${bullet}`}
                      className="progression-series-rules-row"
                    >
                      {bullet}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </SeriesInfoModal>
      ) : null}

      {openModal === "banlist" ? (
        <SeriesInfoModal
          kicker="SERIES"
          title="Banlist"
          onClose={() => setOpenModal(null)}
        >
          <div className="progression-series-banlist-headline">
            {activeSeriesName || "Active Series"}
          </div>

          {banlistLoading ? (
            <div className="progression-series-banlist-empty">Loading banlist...</div>
          ) : banlistError ? (
            <div className="progression-series-banlist-error">{banlistError}</div>
          ) : (
            <div className="progression-series-banlist-grid">
              {[
                ["Forbidden", groupedBanlistRows.forbidden],
                ["Limited", groupedBanlistRows.limited],
                ["Semi-Limited", groupedBanlistRows.semiLimited],
                ["Unlimited", groupedBanlistRows.unlimited],
              ].map(([label, rows]) => (
                <section className="progression-series-banlist-section" key={label}>
                  <div className="progression-series-banlist-section-header">
                    <h3>{label}</h3>
                    <span>{rows.length}</span>
                  </div>

                  {rows.length === 0 ? (
                    <div className="progression-series-banlist-empty small">
                      No cards in this section.
                    </div>
                  ) : (
                    <div className="progression-series-banlist-list">
                      {rows.map((row) => (
                        <div
                          className="progression-series-banlist-row"
                          key={`${label}-${row.card_id}`}
                        >
                          <span>{row.card_name}</span>
                          <strong>#{row.card_id}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </SeriesInfoModal>
      ) : null}
    </>
  );
}

export default ProgressionSeriesMenuPanel;

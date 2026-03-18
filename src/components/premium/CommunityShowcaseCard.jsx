import "./CommunityShowcaseCard.css";

function getStyleId(showcase, slotCode) {
  return showcase?.equipped_by_slot?.[slotCode]?.metadata?.styleId || "";
}

function buildCardImageUrl(showcase) {
  if (showcase?.featured_card_image_url) return showcase.featured_card_image_url;
  if (showcase?.featured_card_id) {
    return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${showcase.featured_card_id}.jpg`;
  }

  return "/ui/project_onyx_logo.png";
}

function CommunityShowcaseCard({
  showcase,
  className = "",
  fallbackLabel = "Project Onyx Spotlight",
}) {
  const frameStyle = getStyleId(showcase, "showcase_frame");
  const pedestalStyle = getStyleId(showcase, "showcase_pedestal");
  const backgroundStyle = getStyleId(showcase, "showcase_background_panel");
  const particleStyle = getStyleId(showcase, "showcase_particles");
  const spotlightStyle = getStyleId(showcase, "showcase_spotlight");
  const bannerTrimStyle = getStyleId(showcase, "showcase_banner_trim");
  const borderStyle = getStyleId(showcase, "showcase_border");
  const cardPedestalStyle = getStyleId(showcase, "showcase_card_pedestal");
  const auraStyle = getStyleId(showcase, "showcase_aura");
  const decorationStyle = getStyleId(showcase, "showcase_decoration");
  const emblemStyle = getStyleId(showcase, "account_emblem");
  const titleFlairStyle = getStyleId(showcase, "title_flair");
  const fallback = !showcase;

  return (
    <article
      className={`community-showcase-card ${className}`.trim()}
      data-frame-style={frameStyle}
      data-pedestal-style={pedestalStyle}
      data-background-style={backgroundStyle}
      data-particle-style={particleStyle}
      data-spotlight-style={spotlightStyle}
      data-banner-style={bannerTrimStyle}
      data-border-style={borderStyle}
      data-card-pedestal-style={cardPedestalStyle}
      data-aura-style={auraStyle}
      data-decoration-style={decorationStyle}
      data-emblem-style={emblemStyle}
      data-title-flair={titleFlairStyle}
      data-fallback={fallback ? "true" : "false"}
    >
      <div className="community-showcase-backdrop" />
      <div className="community-showcase-particles" />
      <div className="community-showcase-decoration" />

      <div className="community-showcase-header">
        <div className="community-showcase-avatar">
          {showcase?.avatar_url ? (
            <img src={showcase.avatar_url} alt={showcase.username || fallbackLabel} />
          ) : (
            <span>{String(showcase?.username || "P").charAt(0).toUpperCase()}</span>
          )}
        </div>

        <div className="community-showcase-header-copy">
          <span className="community-showcase-label">
            {fallback ? "Community Showcase" : showcase.username}
          </span>
          <h3>{showcase?.headline || fallbackLabel}</h3>
          <p>
            {showcase?.subheadline ||
              "Public showcases will rotate here once players make them visible from Profile."}
          </p>
        </div>
      </div>

      <div className="community-showcase-body">
        <div className="community-showcase-cardcase">
          <div className="community-showcase-spotlight" />
          <div className="community-showcase-card-pedestal" />
          <img
            src={buildCardImageUrl(showcase)}
            alt={showcase?.featured_card_name || fallbackLabel}
            className="community-showcase-featured-card"
          />
          <div className="community-showcase-card-note">
            <strong>{showcase?.featured_card_name || "Featured Favorite Card"}</strong>
            <span>
              {showcase?.featured_card_note ||
                "Use the Profile showcase editor to choose a favorite card and set the public panel live."}
            </span>
          </div>
        </div>

        <div className="community-showcase-info">
          <section className="community-showcase-panel">
            <span className="community-showcase-panel-label">Deck Spotlight</span>
            <strong>{showcase?.deck_spotlight_title || "Your Signature Deck"}</strong>
            <p>
              {showcase?.deck_spotlight_text ||
                "Highlight a deck identity, banner, or flex line from your profile editor."}
            </p>
          </section>

          <section className="community-showcase-panel">
            <span className="community-showcase-panel-label">Rare / Flex Display</span>
            <strong>{showcase?.flex_title || "Flex Area"}</strong>
            <p>
              {showcase?.flex_text ||
                "Show off achievements, collection notes, or rare account cosmetics here."}
            </p>
          </section>

          <section className="community-showcase-panel">
            <span className="community-showcase-panel-label">Highlight</span>
            <strong>{showcase?.highlight_title || "Project Onyx News"}</strong>
            <p>
              {showcase?.highlight_text ||
                "Premium showcase objects, frames, particles, and decorations will all appear here once equipped."}
            </p>
          </section>
        </div>
      </div>
    </article>
  );
}

export default CommunityShowcaseCard;

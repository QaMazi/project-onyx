document.addEventListener("DOMContentLoaded", () => {
  const inventoryGrid = document.getElementById("inventoryGrid");

  function formatItemType(item) {
    switch (item.type) {
      case "random_key":
        return "Random Key";
      case "specific_key":
        return "Specific Key";
      case "feature_token":
        return "Feature Token";
      default:
        return "Inventory Item";
    }
  }

  function renderInventory() {
    if (!inventoryGrid) return;

    const players = getPlayers();
    inventoryGrid.innerHTML = "";

    players.forEach((player) => {
      const card = document.createElement("article");
      card.className = "inventory-player-card";

      const inventoryContent =
        Array.isArray(player.inventory) && player.inventory.length
          ? `
            <div class="inventory-list">
              ${player.inventory
                .map(
                  (item) => `
                    <div class="inventory-item">
                      ${item.label || "Unnamed Item"}
                      <span class="inventory-item-type">${formatItemType(item)}</span>
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : `<p class="inventory-empty">No items currently in inventory.</p>`;

      card.innerHTML = `
        <div class="inventory-player-header">
          <h3 class="inventory-player-name">${player.name}</h3>
          <span class="inventory-credit-label">Credits</span>
          <div class="inventory-credit-value">${player.credits}</div>
        </div>

        <div class="inventory-player-body">
          <h4 class="inventory-section-title">Inventory</h4>
          ${inventoryContent}
        </div>
      `;

      inventoryGrid.appendChild(card);
    });
  }

  renderInventory();
});
import AdminPanelContent from "../Pages/Admin/AdminPanelContent";
import "../Pages/Admin/AdminPanelPage.css";

function AdminPanelModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div
        className="admin-modal-shell"
        onClick={(event) => event.stopPropagation()}
      >
        <AdminPanelContent onBack={onClose} backLabel="Close" />
      </div>
    </div>
  );
}

export default AdminPanelModal;

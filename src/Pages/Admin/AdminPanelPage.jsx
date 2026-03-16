import { useLocation, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import AdminPanelContent from "./AdminPanelContent";
import "./AdminPanelPage.css";

function AdminPanelPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const backTarget = location.state?.from || "/mode";

  return (
    <LauncherLayout>
      <div className="admin-page-wrap">
        <AdminPanelContent onBack={() => navigate(backTarget)} backLabel="← Back" />
      </div>
    </LauncherLayout>
  );
}

export default AdminPanelPage;

import React, { useState, useEffect } from "react";
import {
  Trash2,
  Plus,
  Syringe,
  Users,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Package,
  Activity,
  Calendar,
  Search,
  X,
  History,
  Clock,
  Upload,
  CalendarClock,
  Edit2,
} from "lucide-react";

import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
  increment,
} from "firebase/firestore";

// ============================
// CONFIG FIREBASE
// ============================
const firebaseConfig = {
  apiKey: "AIzaSyA3we_zXf-NS_WKDE8rOLEVvpWAzsBfkQU",
  authDomain: "clinicaestoquethc.firebaseapp.com",
  projectId: "clinicaestoquethc",
  storageBucket: "clinicaestoquethc.firebasestorage.app",
  messagingSenderId: "700610674954",
  appId: "1:700610674954:web:8f22262a7350808a787af3",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================
// APP PRINCIPAL
// ============================
export default function ClinicStockApp() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("agenda"); // agenda | estoque | pacientes | planejamento
  const [inventory, setInventory] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [stockLogs, setStockLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // ---------- AUTENTICAÇÃO ----------
  useEffect(() => {
    signInAnonymously(auth).catch((error) => {
      console.error("Erro no login:", error);
      setErrorMsg("Erro ao fazer login anônimo: " + error.message);
      setLoading(false);
    });

    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // ---------- CARREGAR DADOS FIRESTORE ----------
  useEffect(() => {
    if (!user) return;

    const handleError = (err, label) => {
      console.error("Erro em " + label, err);
      let msg = err.message || String(err);
      if (msg.includes("insufficient-permissions")) {
        msg =
          "Permissão negada. Verifique as Regras de Segurança do Firestore.";
      }
      setErrorMsg(`Falha ao carregar ${label}: ${msg}`);
      setLoading(false);
    };

    const invRef = collection(db, "inventory");
    const unsubInv = onSnapshot(
      invRef,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setInventory(items);
      },
      (err) => handleError(err, "estoque")
    );

    const schRef = collection(db, "schedule");
    const unsubSch = onSnapshot(
      schRef,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSchedule(items);
        setLoading(false);
      },
      (err) => handleError(err, "agenda")
    );

    const logsRef = collection(db, "stock_logs");
    const unsubLogs = onSnapshot(
      logsRef,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort(
          (a, b) =>
            (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
        );
        setStockLogs(items);
      },
      (err) => console.error("Erro logs", err)
    );

    return () => {
      unsubInv();
      unsubSch();
      unsubLogs();
    };
  }, [user]);

  // ---------- HANDLERS DE ESTOQUE ----------
  const handleAddInventory = async (item) => {
    try {
      await addDoc(collection(db, "inventory"), {
        ...item,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      alert("Erro ao cadastrar insumo: " + err.message);
    }
  };

  const handleEditInventory = async (item) => {
    try {
      const ref = doc(db, "inventory", item.id);
      await updateDoc(ref, {
        name: item.name,
        unit: item.unit,
        quantity: Number(item.quantity) || 0,
        minStock: Number(item.minStock) || 0,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      alert("Erro ao atualizar insumo: " + err.message);
    }
  };

  const handleDeleteInventory = async (id) => {
    try {
      await deleteDoc(doc(db, "inventory", id));
    } catch (err) {
      alert("Erro ao excluir insumo: " + err.message);
    }
  };

  const handleUpdateStock = async (id, quantityToAdd, itemName) => {
    try {
      const qty = Number(quantityToAdd) || 0;
      const itemRef = doc(db, "inventory", id);

      await updateDoc(itemRef, {
        quantity: increment(qty),
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "stock_logs"), {
        itemId: id,
        itemName,
        quantity: qty,
        type: "entry",
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
      alert("Erro ao registrar entrada de estoque: " + err.message);
    }
  };

  // Importar insumos (Nome, Unidade, Quantidade, Minimo)
  const handleImportInventoryCSV = async (csvText) => {
    try {
      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        alert("Arquivo vazio.");
        return;
      }

      const batch = writeBatch(db);
      let count = 0;

      for (const line of lines) {
        const cols = line.split(",").map((c) => c.trim());
        if (cols.length < 3) continue;

        const [name, unit, quantity, minStock] = cols;
        if (!name) continue;

        const ref = doc(collection(db, "inventory"));
        batch.set(ref, {
          name,
          unit: unit || "un",
          quantity: Number(quantity) || 0,
          minStock: Number(minStock) || 0,
          createdAt: serverTimestamp(),
        });
        count++;
      }

      await batch.commit();
      alert(`${count} insumo(s) importado(s) com sucesso.`);
    } catch (err) {
      console.error(err);
      alert("Erro ao importar insumos: " + err.message);
    }
  };

  // Importar agenda de aplicações (patientName,medicationName,dose,date)
  const handleImportAgendaCSV = async (csvText) => {
    try {
      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length <= 1 && lines[0]?.toLowerCase().includes("patient")) {
        alert("Nenhum registro de agenda encontrado.");
        return;
      }

      // Se primeira linha for cabeçalho, ignora
      let startIndex = 0;
      if (lines[0].toLowerCase().includes("patient")) {
        startIndex = 1;
      }

      const batch = writeBatch(db);
      let count = 0;

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        const cols = line.split(",").map((c) => c.trim());
        if (cols.length < 4) continue;

        const [patientName, medicationName, doseStr, dateStr] = cols;
        if (!patientName || !medicationName || !doseStr || !dateStr) continue;

        const dose = Number(doseStr.toString().replace(",", ".")) || 0;
        if (!dose) continue;

        // tenta achar insumo pelo nome
        const inv = inventory.find(
          (i) => i.name.toLowerCase().trim() === medicationName.toLowerCase().trim()
        );

        let parsedDate = new Date(dateStr + "T00:00:00");
        if (isNaN(parsedDate.getTime())) {
          continue;
        }

        const tsDate = Timestamp.fromDate(parsedDate);

        const ref = doc(collection(db, "schedule"));
        batch.set(ref, {
          patientName,
          items: [
            {
              medicationId: inv ? inv.id : null,
              medicationName,
              dose,
            },
          ],
          date: tsDate,
          status: "scheduled",
          createdAt: serverTimestamp(),
        });

        count++;
      }

      await batch.commit();
      alert(`${count} agendamento(s) importado(s) com sucesso.`);
    } catch (err) {
      console.error(err);
      alert("Erro ao importar agenda: " + err.message);
    }
  };

  // ---------- HANDLERS AGENDA / APLICAÇÃO ----------
  const handleSchedule = async (data) => {
    try {
      await addDoc(collection(db, "schedule"), {
        ...data,
        status: data.status || "scheduled",
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
      alert("Erro ao agendar protocolo: " + err.message);
    }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      await deleteDoc(doc(db, "schedule", id));
    } catch (err) {
      console.error(err);
      alert("Erro ao excluir agendamento: " + err.message);
    }
  };

  const handleApply = async (appointment, actualDateString) => {
    try {
      const itemsToUse =
        appointment.items && appointment.items.length > 0
          ? appointment.items
          : [];

      if (itemsToUse.length === 0) {
        alert("Nenhum insumo vinculado à aplicação.");
        return;
      }

      // valida estoque
      for (const it of itemsToUse) {
        if (!it.medicationId) {
          alert(
            `Insumo "${it.medicationName || "sem nome"}" não está vinculado ao estoque.`
          );
          return;
        }
        const stockItem = inventory.find((i) => i.id === it.medicationId);
        if (!stockItem) {
          alert(
            `Insumo "${it.medicationName || "sem nome"}" não encontrado no estoque.`
          );
          return;
        }
        const dose = Number(it.dose) || 0;
        if (stockItem.quantity < dose) {
          alert(
            `Estoque insuficiente de ${stockItem.name}. Tem ${stockItem.quantity}, precisa de ${dose}.`
          );
          return;
        }
      }

      const baseDate = new Date(actualDateString + "T00:00:00");
      const tsApplied = Timestamp.fromDate(baseDate);

      const batch = writeBatch(db);

      // dá baixa no estoque
      for (const it of itemsToUse) {
        const dose = Number(it.dose) || 0;
        const itemRef = doc(db, "inventory", it.medicationId);
        batch.update(itemRef, {
          quantity: increment(-dose),
          updatedAt: serverTimestamp(),
        });

        const stockItem = inventory.find((i) => i.id === it.medicationId);
        const logRef = doc(collection(db, "stock_logs"));
        batch.set(logRef, {
          itemId: it.medicationId,
          itemName: stockItem?.name || it.medicationName || "Insumo",
          quantity: dose,
          type: "usage",
          createdAt: serverTimestamp(),
        });
      }

      const schRef = doc(db, "schedule", appointment.id);
      batch.update(schRef, {
        status: "applied",
        appliedAt: tsApplied,
      });

      await batch.commit();
    } catch (err) {
      console.error(err);
      alert("Erro ao registrar aplicação: " + err.message);
    }
  };

  const handleUndo = async (appointment) => {
    try {
      const itemsToUse =
        appointment.items && appointment.items.length > 0
          ? appointment.items
          : [];

      if (itemsToUse.length === 0) {
        alert("Nenhum insumo vinculado à aplicação.");
        return;
      }

      const batch = writeBatch(db);

      for (const it of itemsToUse) {
        if (!it.medicationId) continue;
        const dose = Number(it.dose) || 0;

        const itemRef = doc(db, "inventory", it.medicationId);
        batch.update(itemRef, {
          quantity: increment(dose),
          updatedAt: serverTimestamp(),
        });

        const stockItem = inventory.find((i) => i.id === it.medicationId);
        const logRef = doc(collection(db, "stock_logs"));
        batch.set(logRef, {
          itemId: it.medicationId,
          itemName: stockItem?.name || it.medicationName || "Insumo",
          quantity: dose,
          type: "reversal",
          createdAt: serverTimestamp(),
        });
      }

      const schRef = doc(db, "schedule", appointment.id);
      batch.update(schRef, {
        status: "scheduled",
        appliedAt: null,
      });

      await batch.commit();
    } catch (err) {
      console.error(err);
      alert("Erro ao desfazer aplicação: " + err.message);
    }
  };

  // ---------- MÉTRICAS HEADER ----------
  const queueCount = schedule.filter((s) => s.status === "scheduled").length;

  const todayAppliedCount = schedule.filter((s) => {
    if (s.status !== "applied" || !s.appliedAt) return false;
    let d;
    if (s.appliedAt instanceof Timestamp) {
      d = s.appliedAt.toDate();
    } else if (s.appliedAt?.seconds != null) {
      d = new Date(s.appliedAt.seconds * 1000);
    } else {
      d = new Date(s.appliedAt);
    }
    if (isNaN(d?.getTime?.())) return false;
    const today = new Date();
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  }).length;

  const criticalCount = inventory.filter(
    (i) => Number(i.quantity) <= Number(i.minStock || 0)
  ).length;

  // ---------- TELAS DE LOADING / ERRO ----------
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-slate-500">
        <div className="h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Carregando sistema da clínica...</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50">
        <AlertTriangle className="w-10 h-10 text-red-500 mb-2" />
        <h2 className="text-lg font-semibold text-red-700 mb-1">
          Falha ao conectar
        </h2>
        <p className="text-sm text-red-600 max-w-md text-center bg-white border border-red-100 rounded-lg px-4 py-3">
          {errorMsg}
        </p>
        <button
          className="mt-4 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // ---------- RENDER PRINCIPAL ----------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-20 md:pb-0">
      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="bg-teal-600 rounded-lg p-2">
              <Activity className="text-white" size={18} />
            </div>
            <div>
              <h1 className="text-sm md:text-base font-bold text-slate-800 leading-tight">
                Clinic<span className="text-teal-600">Control</span>
              </h1>
              <p className="text-[11px] text-slate-400">
                Enfermagem · Estoque · Planejamento
              </p>
            </div>
          </div>

          <nav className="hidden md:flex gap-2">
            <NavButton
              label="Enfermaria"
              icon={<Users size={15} />}
              active={activeTab === "agenda"}
              onClick={() => setActiveTab("agenda")}
            />
            <NavButton
              label="Estoque"
              icon={<Package size={15} />}
              active={activeTab === "estoque"}
              onClick={() => setActiveTab("estoque")}
            />
            <NavButton
              label="Pacientes"
              icon={<Syringe size={15} />}
              active={activeTab === "pacientes"}
              onClick={() => setActiveTab("pacientes")}
            />
            <NavButton
              label="Planejamento"
              icon={<BarChart3 size={15} />}
              active={activeTab === "planejamento"}
              onClick={() => setActiveTab("planejamento")}
            />
          </nav>
        </div>

        {/* MÉTRICAS HEADER */}
        <div className="bg-slate-50 border-t border-slate-100">
          <div className="max-w-6xl mx-auto px-4 py-2 grid grid-cols-3 gap-2 text-[11px]">
            <MetricPill
              icon={<Users size={13} />}
              label="Fila de aplicação"
              value={queueCount}
            />
            <MetricPill
              icon={<CheckCircle size={13} />}
              label="Aplicados hoje"
              value={todayAppliedCount}
            />
            <MetricPill
              icon={<AlertTriangle size={13} />}
              label="Insumos críticos"
              value={criticalCount}
              danger={criticalCount > 0}
            />
          </div>
        </div>
      </header>

      {/* CONTEÚDO */}
      <main className="max-w-6xl mx-auto px-4 py-4 md:py-6 space-y-4">
        {activeTab === "estoque" && (
          <InventoryTab
            inventory={inventory}
            stockLogs={stockLogs}
            onAdd={handleAddInventory}
            onEditItem={handleEditInventory}
            onImport={handleImportInventoryCSV}
            onImportAgenda={handleImportAgendaCSV}
            onUpdateStock={handleUpdateStock}
            onDelete={handleDeleteInventory}
          />
        )}

        {activeTab === "agenda" && (
          <ScheduleTab
            inventory={inventory}
            schedule={schedule}
            onSchedule={handleSchedule}
            onApply={handleApply}
            onUndo={handleUndo}
            onDelete={handleDeleteSchedule}
          />
        )}

        {activeTab === "pacientes" && (
          <PatientsTab
            schedule={schedule}
            inventory={inventory}
            onSchedule={handleSchedule}
            onApply={handleApply}
            onUndo={handleUndo}
          />
        )}

        {activeTab === "planejamento" && (
          <DashboardTab inventory={inventory} schedule={schedule} />
        )}
      </main>

      {/* NAV MOBILE */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-30">
        <div className="flex">
          <MobileNavButton
            label="Enfermaria"
            icon={<Users size={18} />}
            active={activeTab === "agenda"}
            onClick={() => setActiveTab("agenda")}
          />
          <MobileNavButton
            label="Estoque"
            icon={<Package size={18} />}
            active={activeTab === "estoque"}
            onClick={() => setActiveTab("estoque")}
          />
          <MobileNavButton
            label="Pacientes"
            icon={<Syringe size={18} />}
            active={activeTab === "pacientes"}
            onClick={() => setActiveTab("pacientes")}
          />
          <MobileNavButton
            label="Planejamento"
            icon={<BarChart3 size={18} />}
            active={activeTab === "planejamento"}
            onClick={() => setActiveTab("planejamento")}
          />
        </div>
      </div>
    </div>
  );
}

// ============================
// COMPONENTES DE NAV
// ============================
function NavButton({ label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
        active
          ? "bg-teal-50 text-teal-700 border border-teal-100"
          : "bg-white text-slate-500 border border-transparent hover:bg-slate-50"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MobileNavButton({ label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center py-2 text-[10px] ${
        active ? "text-teal-600 bg-teal-50" : "text-slate-400"
      }`}
    >
      {icon}
      <span className="mt-0.5 font-medium">{label}</span>
    </button>
  );
}

function MetricPill({ icon, label, value, danger }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] ${
        danger
          ? "border-red-100 bg-red-50 text-red-700"
          : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      {icon}
      <span className="font-semibold">{value}</span>
      <span className="text-[10px]">{label}</span>
    </div>
  );
}

// ============================
// A PARTIR DAQUI VÃO AS OUTRAS PARTES:
// - PARTE 2: InventoryTab
// - PARTE 3: helper de data + ScheduleTab
// - PARTE 4: PatientsTab + DashboardTab
// ============================
// ============================
// PARTE 2 - ABA ESTOQUE / INVENTORYTAB
// ============================
function InventoryTab({
  inventory,
  stockLogs,
  onAdd,
  onEditItem,
  onImport,
  onImportAgenda,
  onUpdateStock,
  onDelete,
}) {
  const [newItem, setNewItem] = useState({
    name: "",
    unit: "ml",
    quantity: "",
    minStock: "",
  });
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [isImportInventoryOpen, setIsImportInventoryOpen] = useState(false);
  const [isImportAgendaOpen, setIsImportAgendaOpen] = useState(false);

  const [stockEntryItem, setStockEntryItem] = useState(null);
  const [stockEntryValue, setStockEntryValue] = useState("");

  const [deleteItem, setDeleteItem] = useState(null);
  const [historyItem, setHistoryItem] = useState(null);

  const [editItem, setEditItem] = useState(null);

  // -------- CADASTRAR NOVO INSUMO --------
  const handleSubmitNewItem = (e) => {
    e.preventDefault();
    if (!newItem.name.trim()) {
      alert("Informe o nome do insumo.");
      return;
    }
    onAdd({
      name: newItem.name.trim(),
      unit: newItem.unit,
      quantity: Number(newItem.quantity) || 0,
      minStock: Number(newItem.minStock) || 0,
    });
    setNewItem({ name: "", unit: "ml", quantity: "", minStock: "" });
    setIsAdding(false);
  };

  // -------- IMPORTAR INSUMOS CSV --------
  const handleFileImportInventory = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        onImport(text);
        setIsImportInventoryOpen(false);
      }
    };
    reader.readAsText(file);
  };

  // -------- IMPORTAR AGENDA CSV --------
  const handleFileImportAgenda = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        onImportAgenda(text);
        setIsImportAgendaOpen(false);
      }
    };
    reader.readAsText(file);
  };

  // -------- ENTRADA DE ESTOQUE --------
  const handleConfirmEntry = () => {
    if (!stockEntryItem) return;
    if (!stockEntryValue) return;

    const qtd = Number(
      stockEntryValue.toString().replace(",", ".").trim()
    );
    if (isNaN(qtd) || qtd === 0) {
      alert("Informe uma quantidade válida.");
      return;
    }

    onUpdateStock(stockEntryItem.id, qtd, stockEntryItem.name);
    setStockEntryItem(null);
    setStockEntryValue("");
  };

  // -------- EXCLUIR INSUMO --------
  const handleConfirmDelete = () => {
    if (!deleteItem) return;
    onDelete(deleteItem.id);
    setDeleteItem(null);
  };

  // -------- SALVAR EDIÇÃO INSUMO --------
  const handleSaveEditItem = () => {
    if (!editItem) return;
    if (!editItem.name?.trim()) {
      alert("Informe o nome do insumo.");
      return;
    }
    onEditItem({
      ...editItem,
      name: editItem.name.trim(),
      quantity: Number(editItem.quantity) || 0,
      minStock: Number(editItem.minStock) || 0,
    });
    setEditItem(null);
  };

  // -------- LISTAGENS --------
  const filteredInventory = inventory
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

  const logsForHistory = historyItem
    ? stockLogs.filter((l) => l.itemId === historyItem.id)
    : [];

  return (
    <div className="space-y-6">
      {/* TOPO / AÇÕES */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-base md:text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Package size={18} className="text-teal-600" />
            Estoque de insumos
          </h2>
          <p className="text-[11px] text-slate-500">
            Controle de insumos, mínimos e entrada de estoque.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <div className="relative flex-1 min-w-[180px]">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Buscar insumo..."
              className="w-full pl-7 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="px-3 py-2 text-[11px] rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 flex items-center gap-1.5"
            onClick={() => setIsImportInventoryOpen(true)}
          >
            <Upload size={14} />
            Importar insumos
          </button>

          <button
            type="button"
            className="px-3 py-2 text-[11px] rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 flex items-center gap-1.5"
            onClick={() => setIsImportAgendaOpen(true)}
          >
            <CalendarClock size={14} />
            Importar agenda
          </button>

          <button
            type="button"
            className="px-3 py-2 text-[11px] rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1.5"
            onClick={() => setIsAdding((v) => !v)}
          >
            <Plus size={14} />
            Novo insumo
          </button>
        </div>
      </div>

      {/* FORM NOVO INSUMO */}
      {isAdding && (
        <form
          onSubmit={handleSubmitNewItem}
          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-xs space-y-3"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-slate-700">
              Cadastrar novo insumo
            </span>
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600"
              onClick={() => setIsAdding(false)}
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-[11px] text-slate-500 mb-1">
                Nome do insumo
              </label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 bg-slate-50"
                placeholder="Ex: Laennec, Ozempic..."
                value={newItem.name}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, name: e.target.value }))
                }
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Unidade
              </label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 bg-slate-50"
                value={newItem.unit}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, unit: e.target.value }))
                }
              >
                <option value="ml">ml</option>
                <option value="mg">mg</option>
                <option value="un">un</option>
                <option value="amp">amp</option>
                <option value="fr">fr</option>
                <option value="caixa">caixa</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Estoque inicial
              </label>
              <input
                type="number"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 bg-slate-50"
                value={newItem.quantity}
                onChange={(e) =>
                  setNewItem((prev) => ({
                    ...prev,
                    quantity: e.target.value,
                  }))
                }
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Estoque mínimo
              </label>
              <input
                type="number"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 bg-slate-50"
                value={newItem.minStock}
                onChange={(e) =>
                  setNewItem((prev) => ({
                    ...prev,
                    minStock: e.target.value,
                  }))
                }
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-2 text-[11px] rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-[11px] rounded-lg bg-teal-600 text-white hover:bg-teal-700"
            >
              Salvar insumo
            </button>
          </div>
        </form>
      )}

      {/* GRID DE INSUMOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredInventory.map((item) => {
          const critical =
            Number(item.quantity) <= Number(item.minStock || 0);

          return (
            <div
              key={item.id}
              className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between relative overflow-hidden"
            >
              <div
                className={`absolute left-0 top-0 w-1 h-full ${
                  critical ? "bg-red-500" : "bg-teal-500"
                }`}
              />

              <div className="flex justify-between items-start gap-2 mb-1">
                <div className="pr-4">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {item.name}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Unidade: {item.unit || "un"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="p-1 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded"
                    title="Editar insumo"
                    onClick={() => setEditItem(item)}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="p-1 text-slate-300 hover:text-slate-700 hover:bg-slate-50 rounded"
                    title="Histórico de estoque"
                    onClick={() => setHistoryItem(item)}
                  >
                    <History size={14} />
                  </button>
                  <button
                    className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded"
                    title="Excluir insumo"
                    onClick={() => setDeleteItem(item)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="mt-2 mb-3">
                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-2xl font-bold ${
                      critical ? "text-red-600" : "text-slate-800"
                    }`}
                  >
                    {item.quantity ?? 0}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {item.unit}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  {critical && (
                    <AlertTriangle size={11} className="text-red-500" />
                  )}
                  Mínimo: {item.minStock ?? 0} {item.unit}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  className="flex-1 px-3 py-1.5 text-[11px] rounded-lg border border-slate-200 text-slate-700 bg-slate-50 hover:bg-teal-50 hover:border-teal-200 hover:text-teal-700 flex items-center justify-center gap-1.5"
                  onClick={() => setStockEntryItem(item)}
                >
                  <Plus size={12} />
                  Entrada de estoque
                </button>
              </div>
            </div>
          );
        })}

        {filteredInventory.length === 0 && (
          <div className="col-span-full bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-xs text-slate-400">
            Nenhum insumo encontrado.
          </div>
        )}
      </div>

      {/* MODAL IMPORTAR INSUMOS */}
      {isImportInventoryOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5 text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Importar insumos (.csv)
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setIsImportInventoryOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Formato esperado (sem cabeçalho obrigatório):<br />
              <code className="bg-slate-50 px-2 py-1 rounded inline-block mt-1">
                Nome,Unidade,QuantidadeInicial,EstoqueMinimo
              </code>
            </p>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center bg-slate-50">
              <Upload className="mx-auto mb-2 text-slate-400" size={20} />
              <p className="text-[11px] text-slate-500 mb-1">
                Clique para selecionar o arquivo CSV
              </p>
              <input
                type="file"
                accept=".csv"
                className="mt-2 text-[11px]"
                onChange={handleFileImportInventory}
              />
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMPORTAR AGENDA */}
      {isImportAgendaOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5 text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Importar agenda (.csv)
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setIsImportAgendaOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Formato esperado com cabeçalho:
              <br />
              <code className="bg-slate-50 px-2 py-1 rounded inline-block mt-1">
                patientName,medicationName,dose,date
              </code>
            </p>
            <p className="text-[11px] text-slate-500 mb-3">
              A dose deve usar ponto como decimal (ex:{" "}
              <strong>7.5</strong>).
            </p>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center bg-slate-50">
              <Upload className="mx-auto mb-2 text-slate-400" size={20} />
              <p className="text-[11px] text-slate-500 mb-1">
                Clique para selecionar o arquivo CSV
              </p>
              <input
                type="file"
                accept=".csv"
                className="mt-2 text-[11px]"
                onChange={handleFileImportAgenda}
              />
            </div>
          </div>
        </div>
      )}

      {/* MODAL ENTRADA ESTOQUE */}
      {stockEntryItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5 text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Entrada de estoque
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => {
                  setStockEntryItem(null);
                  setStockEntryValue("");
                }}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              Insumo:
              <br />
              <span className="font-semibold text-slate-700">
                {stockEntryItem.name}
              </span>
            </p>
            <label className="block text-[11px] text-slate-500 mb-1">
              Quantidade ({stockEntryItem.unit})
            </label>
            <input
              type="number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 mb-4"
              value={stockEntryValue}
              onChange={(e) => setStockEntryValue(e.target.value)}
              placeholder="Ex: 10"
            />
            <div className="flex gap-2">
              <button
                className="flex-1 text-[11px] px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => {
                  setStockEntryItem(null);
                  setStockEntryValue("");
                }}
              >
                Cancelar
              </button>
              <button
                className="flex-1 text-[11px] px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                onClick={handleConfirmEntry}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EXCLUIR INSUMO */}
      {deleteItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5 text-xs">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
              <Trash2 size={18} className="text-red-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700 text-center mb-1">
              Excluir insumo
            </h3>
            <p className="text-[11px] text-slate-500 text-center mb-4">
              Tem certeza que deseja remover o insumo{" "}
              <strong>{deleteItem.name}</strong>? Essa ação não pode ser
              desfeita.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 text-[11px] px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => setDeleteItem(null)}
              >
                Cancelar
              </button>
              <button
                className="flex-1 text-[11px] px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
                onClick={handleConfirmDelete}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL HISTÓRICO */}
      {historyItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5 text-xs max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <History size={14} className="text-teal-600" />
                  Histórico de estoque
                </h3>
                <p className="text-[11px] text-slate-500">
                  {historyItem.name}
                </p>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setHistoryItem(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {logsForHistory.length === 0 && (
                <p className="text-[11px] text-slate-400 text-center py-4">
                  Nenhum registro encontrado para este insumo.
                </p>
              )}

              {logsForHistory.map((log) => {
                const dt =
                  log.createdAt?.seconds != null
                    ? new Date(log.createdAt.seconds * 1000)
                    : null;
                const isReversal = log.type === "reversal";
                const isUsage = log.type === "usage";
                const isEntry = log.type === "entry";

                return (
                  <div
                    key={log.id}
                    className="border border-slate-100 rounded-lg px-3 py-2 flex items-center justify-between bg-slate-50"
                  >
                    <div>
                      <p className="text-[11px] font-semibold text-slate-700">
                        {isEntry && "Entrada"}
                        {isUsage && "Saída / aplicação"}
                        {isReversal && "Estorno"}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Quantidade:{" "}
                        <strong>{log.quantity ?? 0}</strong>{" "}
                        {historyItem.unit}
                      </p>
                    </div>
                    <div className="text-right text-[10px] text-slate-400">
                      {dt && (
                        <>
                          <div>{dt.toLocaleDateString("pt-BR")}</div>
                          <div>
                            {dt.toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              className="mt-3 w-full text-[11px] px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
              onClick={() => setHistoryItem(null)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* MODAL EDITAR INSUMO */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5 text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Edit2 size={14} className="text-blue-600" />
                Editar insumo
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setEditItem(null)}
              >
                <X size={16} />
              </button>
            </div>

            <label className="block text-[11px] text-slate-500 mb-1">
              Nome
            </label>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-slate-50"
              value={editItem.name}
              onChange={(e) =>
                setEditItem((prev) => ({ ...prev, name: e.target.value }))
              }
            />

            <label className="block text-[11px] text-slate-500 mb-1">
              Unidade
            </label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-slate-50"
              value={editItem.unit}
              onChange={(e) =>
                setEditItem((prev) => ({ ...prev, unit: e.target.value }))
              }
            >
              <option value="ml">ml</option>
              <option value="mg">mg</option>
              <option value="un">un</option>
              <option value="amp">amp</option>
              <option value="fr">fr</option>
              <option value="caixa">caixa</option>
            </select>

            <label className="block text-[11px] text-slate-500 mb-1">
              Estoque mínimo
            </label>
            <input
              type="number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-slate-50"
              value={editItem.minStock ?? 0}
              onChange={(e) =>
                setEditItem((prev) => ({
                  ...prev,
                  minStock: e.target.value,
                }))
              }
            />

            <label className="block text-[11px] text-slate-500 mb-1">
              Estoque atual
            </label>
            <input
              type="number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-slate-50"
              value={editItem.quantity ?? 0}
              onChange={(e) =>
                setEditItem((prev) => ({
                  ...prev,
                  quantity: e.target.value,
                }))
              }
            />

            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-2 text-[11px] rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => setEditItem(null)}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 text-[11px] rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleSaveEditItem}
              >
                Salvar alterações
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ============================
// PARTE 3 - HELPERS DE DATA
// ============================

// Converte qualquer formato (Timestamp, {seconds}, string) em Date
function getDateFromField(value) {
  if (!value) return null;

  // Firestore Timestamp
  if (value.toDate && typeof value.toDate === "function") {
    return value.toDate();
  }

  // Objeto com seconds
  if (value.seconds != null) {
    return new Date(value.seconds * 1000);
  }

  // String (YYYY-MM-DD)
  if (typeof value === "string") {
    const d = new Date(value + "T00:00:00");
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateShort(value) {
  const d = getDateFromField(value);
  if (!d) return "";
  return d.toLocaleDateString("pt-BR");
}

function isPastDate(value) {
  const d = getDateFromField(value);
  if (!d) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d.getTime() < hoje.getTime();
}

// ============================
// PARTE 3 - ABA ENFERMARIA / AGENDA
// ============================
function ScheduleTab({ inventory, schedule, onSchedule, onApply, onUndo, onDelete }) {
  const todayStr = new Date().toISOString().split("T")[0];

  const [newPatient, setNewPatient] = React.useState({
    patientName: "",
    date: todayStr,
    sessions: 1,
    items: [
      {
        id: Date.now(),
        medicationId: "",
        dose: "",
      },
    ],
  });

  const [applyModalItem, setApplyModalItem] = React.useState(null);
  const [applyDate, setApplyDate] = React.useState(todayStr);

  // ----- FORM: MANIPULAR LINHAS DE INSUMOS -----
  const addLine = () => {
    setNewPatient((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: Date.now() + Math.random(),
          medicationId: "",
          dose: "",
        },
      ],
    }));
  };

  const removeLine = (id) => {
    setNewPatient((prev) => {
      if (prev.items.length === 1) return prev; // sempre pelo menos 1 linha
      return {
        ...prev,
        items: prev.items.filter((i) => i.id !== id),
      };
    });
  };

  const updateLine = (id, field, value) => {
    setNewPatient((prev) => ({
      ...prev,
      items: prev.items.map((i) =>
        i.id === id ? { ...i, [field]: value } : i
      ),
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newPatient.patientName.trim()) {
      alert("Informe o nome do paciente.");
      return;
    }

    const cleanedItems = newPatient.items
      .filter((i) => i.medicationId && i.dose)
      .map((i) => ({
        medicationId: i.medicationId,
        dose: Number(i.dose.toString().replace(",", ".")) || 0,
      }));

    if (cleanedItems.length === 0) {
      alert("Informe pelo menos um insumo e dose.");
      return;
    }

    const sessions = Number(newPatient.sessions) || 1;
    const startDate = new Date(newPatient.date + "T00:00:00");
    if (isNaN(startDate.getTime())) {
      alert("Data inicial inválida.");
      return;
    }

    for (let i = 0; i < sessions; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i * 7); // semanal

      onSchedule({
        patientName: newPatient.patientName.trim(),
        items: cleanedItems,
        date: Timestamp.fromDate(d), // salva como Timestamp
        status: "scheduled",
        sessionInfo: sessions > 1 ? `${i + 1}/${sessions}` : null,
      });
    }

    setNewPatient({
      patientName: "",
      date: todayStr,
      sessions: 1,
      items: [
        {
          id: Date.now(),
          medicationId: "",
          dose: "",
        },
      ],
    });
  };

  // ----- ABRIR / CONFIRMAR MODAL DE APLICAÇÃO -----
  const openApplyModal = (item) => {
    setApplyModalItem(item);
    setApplyDate(todayStr);
  };

  const confirmApply = () => {
    if (!applyModalItem || !applyDate) return;
    onApply(applyModalItem, applyDate);
    setApplyModalItem(null);
  };

  // ----- LISTAS: PENDENTES E HISTÓRICO -----
  const pending = schedule
    .filter((s) => s.status === "scheduled")
    .sort((a, b) => {
      const da = getDateFromField(a.date) || new Date(0);
      const db = getDateFromField(b.date) || new Date(0);
      return da - db;
    });

  const history = schedule
    .filter((s) => s.status === "applied")
    .sort((a, b) => {
      const da = getDateFromField(a.appliedAt) || new Date(0);
      const db = getDateFromField(b.appliedAt) || new Date(0);
      return db - da;
    });

  // ----- RENDER RESUMO DOS INSUMOS EM UMA APLICAÇÃO -----
  const renderItemsSummary = (items) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="mt-1 space-y-0.5">
        {items.map((it, idx) => {
          const inv = it.medicationId
            ? inventory.find((x) => x.id === it.medicationId)
            : null;
          const name = inv?.name || it.medicationName || "Insumo";
          const unit = inv?.unit || "";
          return (
            <div
              key={idx}
              className="flex items-center gap-1.5 text-[11px] text-slate-500"
            >
              <Syringe size={11} className="text-slate-400" />
              <span className="truncate">{name}</span>
              <span className="text-slate-300">•</span>
              <span className="font-semibold text-teal-600">
                {it.dose} {unit}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* FORM NOVO AGENDAMENTO */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-xs space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Calendar size={16} className="text-teal-600" />
              Agendar protocolo
            </h2>
            <p className="text-[11px] text-slate-500">
              Monte protocolos com múltiplos insumos e repetições semanais.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start"
        >
          <div className="md:col-span-12">
            <label className="block text-[11px] text-slate-500 mb-1">
              Paciente
            </label>
            <input
              type="text"
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              placeholder="Nome completo do paciente"
              value={newPatient.patientName}
              onChange={(e) =>
                setNewPatient((prev) => ({
                  ...prev,
                  patientName: e.target.value,
                }))
              }
            />
          </div>

          <div className="md:col-span-12 bg-slate-50 border border-slate-100 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-700">
                Insumos do protocolo
              </span>
              <button
                type="button"
                className="text-[11px] text-teal-600 hover:underline flex items-center gap-1"
                onClick={addLine}
              >
                <Plus size={11} />
                Adicionar insumo
              </button>
            </div>

            <div className="space-y-2">
              {newPatient.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-2"
                >
                  <select
                    className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    value={item.medicationId}
                    onChange={(e) =>
                      updateLine(item.id, "medicationId", e.target.value)
                    }
                    required
                  >
                    <option value="">Selecione o insumo...</option>
                    {inventory
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.name} ({inv.unit})
                        </option>
                      ))}
                  </select>

                  <input
                    type="number"
                    className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    placeholder="Dose"
                    value={item.dose}
                    onChange={(e) =>
                      updateLine(item.id, "dose", e.target.value)
                    }
                    required
                  />

                  {newPatient.items.length > 1 && (
                    <button
                      type="button"
                      className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded"
                      onClick={() => removeLine(item.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="md:col-span-4">
            <label className="block text-[11px] text-slate-500 mb-1">
              Início
            </label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[11px] bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={newPatient.date}
              onChange={(e) =>
                setNewPatient((prev) => ({ ...prev, date: e.target.value }))
              }
              required
            />
          </div>

          <div className="md:col-span-4">
            <label className="block text-[11px] text-slate-500 mb-1">
              Repetições (semanas)
            </label>
            <input
              type="number"
              min={1}
              max={52}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[11px] bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={newPatient.sessions}
              onChange={(e) =>
                setNewPatient((prev) => ({
                  ...prev,
                  sessions: e.target.value,
                }))
              }
            />
          </div>

          <div className="md:col-span-4 flex items-end">
            <button
              type="submit"
              className="w-full bg-teal-600 text-white rounded-lg px-3 py-2 text-[11px] font-semibold hover:bg-teal-700 flex items-center justify-center gap-1.5"
            >
              <Plus size={13} />
              Agendar protocolo
            </button>
          </div>
        </form>
      </div>

      {/* LISTAS: PENDENTES E HISTÓRICO */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* PENDENTES */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Fila de aplicação
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
              {pending.length} pendente(s)
            </span>
          </div>

          {pending.length === 0 && (
            <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center text-[11px] text-slate-400">
              Nenhum paciente na fila.
            </div>
          )}

          <div className="space-y-2">
            {pending.map((item) => {
              const late = isPastDate(item.date);
              const dt = formatDateShort(item.date);

              return (
                <div
                  key={item.id}
                  className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3 shadow-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {item.patientName}
                      </p>
                      {item.sessionInfo && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                          {item.sessionInfo}
                        </span>
                      )}
                    </div>
                    {renderItemsSummary(item.items)}
                    <div className="mt-1 flex items-center gap-1 text-[10px]">
                      {late && (
                        <AlertTriangle
                          size={10}
                          className="text-red-500"
                        />
                      )}
                      <span
                        className={
                          late
                            ? "text-red-600 font-medium"
                            : "text-slate-400"
                        }
                      >
                        Agendado: {dt || "-"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 text-[11px]">
                    <button
                      className="px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      className="px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1"
                      onClick={() => openApplyModal(item)}
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* HISTÓRICO */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            Últimas aplicações
          </h3>

          {history.length === 0 && (
            <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center text-[11px] text-slate-400">
              Nenhuma aplicação registrada ainda.
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {history.slice(0, 15).map((item) => {
              const d = getDateFromField(item.appliedAt);
              return (
                <div
                  key={item.id}
                  className="px-3 py-2 flex items-center justify-between gap-3 text-[11px] hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle
                        size={12}
                        className="text-teal-500"
                      />
                      <span className="font-semibold text-slate-700 truncate">
                        {item.patientName}
                      </span>
                      {item.sessionInfo && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                          {item.sessionInfo}
                        </span>
                      )}
                    </div>
                    {renderItemsSummary(item.items)}
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="text-right text-[10px] text-slate-400">
                      {d && (
                        <>
                          <div>
                            {d.toLocaleDateString("pt-BR")}
                          </div>
                          <div>
                            {d.toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      className="px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 flex items-center gap-1"
                      onClick={() => onUndo(item)}
                    >
                      <Clock size={11} />
                      Desfazer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* MODAL CONFIRMAR APLICAÇÃO */}
      {applyModalItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5 text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <CheckCircle size={14} className="text-teal-600" />
                Confirmar aplicação
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setApplyModalItem(null)}
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 mb-2">
              Paciente:
              <br />
              <span className="font-semibold text-slate-800">
                {applyModalItem.patientName}
              </span>
            </p>

            {renderItemsSummary(applyModalItem.items)}

            <label className="block text-[11px] text-slate-500 mt-3 mb-1">
              Data real da aplicação
            </label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[11px] mb-4 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={applyDate}
              onChange={(e) => setApplyDate(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                className="flex-1 text-[11px] px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => setApplyModalItem(null)}
              >
                Cancelar
              </button>
              <button
                className="flex-1 text-[11px] px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                onClick={confirmApply}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ============================
// PARTE 4 - ABA PACIENTES
// ============================
function PatientsTab({ schedule, inventory, onApply, onUndo }) {
  const [search, setSearch] = React.useState("");
  const [selectedPatient, setSelectedPatient] = React.useState(null);

  const todayStr = new Date().toISOString().split("T")[0];

  // Monta lista de pacientes a partir da agenda
  const patientsMap = {};
  schedule.forEach((s) => {
    if (!s.patientName) return;
    const key = s.patientName.trim().toLowerCase();
    if (!patientsMap[key]) {
      patientsMap[key] = {
        name: s.patientName.trim(),
        total: 0,
        pending: 0,
        applied: 0,
      };
    }
    patientsMap[key].total++;
    if (s.status === "applied") patientsMap[key].applied++;
    if (s.status === "scheduled") patientsMap[key].pending++;
  });

  const patients = Object.values(patientsMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const filteredPatients = patients.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  // Aplicações do paciente selecionado
  const selectedAppointments = schedule
    .filter(
      (s) =>
        selectedPatient &&
        s.patientName &&
        s.patientName.trim().toLowerCase() ===
          selectedPatient.trim().toLowerCase()
    )
    .sort((a, b) => {
      const da = getDateFromField(a.date) || new Date(0);
      const db = getDateFromField(b.date) || new Date(0);
      return da - db;
    });

  const renderItemsSummary = (items) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="mt-0.5 space-y-0.5">
        {items.map((it, idx) => {
          const inv = it.medicationId
            ? inventory.find((x) => x.id === it.medicationId)
            : null;
          const name = inv?.name || it.medicationName || "Insumo";
          const unit = inv?.unit || "";
          return (
            <div
              key={idx}
              className="flex items-center gap-1.5 text-[11px] text-slate-500"
            >
              <Syringe size={11} className="text-slate-400" />
              <span className="truncate">{name}</span>
              <span className="text-slate-300">•</span>
              <span className="font-semibold text-teal-600">
                {it.dose} {unit}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const handleApplyHere = (appt) => {
    onApply(appt, todayStr);
  };

  const handleUndoHere = (appt) => {
    onUndo(appt);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* LISTA DE PACIENTES */}
      <div className="lg:col-span-1 space-y-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-xs">
          <h2 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
            <Users size={15} className="text-teal-600" />
            Pacientes
          </h2>
          <div className="relative mb-2">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Buscar paciente..."
              className="w-full border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-[11px] bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-slate-500">
              {filteredPatients.length} paciente(s)
            </span>
          </div>

          <div className="mt-2 max-h-[60vh] overflow-y-auto space-y-1.5 pr-1">
            {filteredPatients.length === 0 && (
              <div className="text-[11px] text-slate-400 text-center py-4">
                Nenhum paciente encontrado.
              </div>
            )}

            {filteredPatients.map((p) => {
              const isSelected =
                selectedPatient &&
                selectedPatient.trim().toLowerCase() ===
                  p.name.trim().toLowerCase();
              return (
                <button
                  key={p.name}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-[11px] flex items-center justify-between gap-2 ${
                    isSelected
                      ? "border-teal-200 bg-teal-50 text-teal-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  onClick={() =>
                    setSelectedPatient(
                      isSelected ? null : p.name.trim()
                    )
                  }
                >
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {p.total} agendamento(s) · {p.pending} pendente(s) ·{" "}
                      {p.applied} aplicado(s)
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* DETALHES DO PACIENTE */}
      <div className="lg:col-span-2 space-y-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-xs min-h-[250px]">
          {!selectedPatient && (
            <div className="h-full flex items-center justify-center text-[11px] text-slate-400">
              Selecione um paciente à esquerda para ver o histórico.
            </div>
          )}

          {selectedPatient && (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">
                    {selectedPatient}
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Todas as aplicações (pendentes e aplicadas).
                  </p>
                </div>
              </div>

              {selectedAppointments.length === 0 && (
                <div className="text-[11px] text-slate-400 text-center py-6">
                  Nenhum agendamento encontrado para este paciente.
                </div>
              )}

              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {selectedAppointments.map((appt) => {
                  const dtAg = formatDateShort(appt.date);
                  const dtAp = formatDateShort(appt.appliedAt);
                  const isPending = appt.status === "scheduled";
                  const isApplied = appt.status === "applied";

                  const items = appt.items && appt.items.length > 0
                    ? appt.items
                    : [];

                  return (
                    <div
                      key={appt.id}
                      className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3 bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              isApplied
                                ? "bg-teal-100 text-teal-700 border border-teal-200"
                                : "bg-amber-50 text-amber-700 border border-amber-100"
                            }`}
                          >
                            {isApplied ? "Aplicado" : "Pendente"}
                          </span>
                          {appt.sessionInfo && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                              {appt.sessionInfo}
                            </span>
                          )}
                        </div>
                        {renderItemsSummary(items)}
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                          <span>
                            Agendado:{" "}
                            <strong>{dtAg || "-"}</strong>
                          </span>
                          {isApplied && (
                            <span>
                              Aplicado em:{" "}
                              <strong>{dtAp || "-"}</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 text-[11px]">
                        {isPending && (
                          <button
                            className="px-2 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1"
                            onClick={() => handleApplyHere(appt)}
                          >
                            Aplicar hoje
                          </button>
                        )}
                        {isApplied && (
                          <button
                            className="px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 flex items-center gap-1"
                            onClick={() => handleUndoHere(appt)}
                          >
                            <Clock size={11} />
                            Desfazer
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================
// PARTE 4 - ABA PLANEJAMENTO / DASHBOARD
// ============================
function DashboardTab({ inventory, schedule }) {
  // Monta análise de consumo futuro e status
  const analysis = {};

  // Inicializa com estoque atual
  inventory.forEach((item) => {
    analysis[item.id] = {
      id: item.id,
      name: item.name,
      unit: item.unit,
      currentStock: Number(item.quantity) || 0,
      minStock: Number(item.minStock) || 0,
      scheduledUsage: 0,
      dailyUsage: [], // {date, amount}
      status: "ok",
      depletionDate: null,
    };
  });

  // Agenda futura (pendente)
  schedule
    .filter((s) => s.status === "scheduled")
    .forEach((s) => {
      const baseDate = getDateFromField(s.date) || new Date();

      const items =
        s.items && s.items.length > 0 ? s.items : [];

      items.forEach((it) => {
        const bucket = analysis[it.medicationId];
        if (!bucket) return;
        const dose = Number(it.dose) || 0;
        bucket.scheduledUsage += dose;
        bucket.dailyUsage.push({
          date: baseDate,
          amount: dose,
        });
      });
    });

  // Calcula status e data prevista de quebra
  Object.values(analysis).forEach((item) => {
    item.dailyUsage.sort((a, b) => a.date - b.date);

    let tempStock = item.currentStock;
    for (const u of item.dailyUsage) {
      tempStock -= u.amount;
      if (tempStock < 0 && !item.depletionDate) {
        item.depletionDate = u.date;
        break;
      }
    }

    const finalStock = item.currentStock - item.scheduledUsage;
    if (finalStock < 0) {
      item.status = "critical";
    } else if (finalStock < item.minStock) {
      item.status = "warning";
    } else {
      item.status = "ok";
    }
  });

  const needs = Object.values(analysis).sort((a, b) => {
    const order = { critical: 0, warning: 1, ok: 2 };
    return order[a.status] - order[b.status];
  });

  const criticalCount = needs.filter((n) => n.status === "critical").length;
  const warningCount = needs.filter((n) => n.status === "warning").length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute right-2 top-2 opacity-10">
            <AlertTriangle size={40} className="text-red-600" />
          </div>
          <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wide mb-1">
            Críticos
          </p>
          <p className="text-3xl font-black text-red-800 mb-1">
            {criticalCount}
          </p>
          <p className="text-[11px] text-red-700">
            Itens que irão acabar com a agenda atual.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 relative overflow-hidden">
          <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide mb-1">
            Atenção
          </p>
          <p className="text-3xl font-black text-amber-800 mb-1">
            {warningCount}
          </p>
          <p className="text-[11px] text-amber-700">
            Itens abaixo do estoque mínimo projetado.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide mb-1">
            Insumos cadastrados
          </p>
          <p className="text-3xl font-black text-slate-900 mb-1">
            {inventory.length}
          </p>
          <p className="text-[11px] text-slate-500">
            Total de insumos ativos no estoque.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <BarChart3 size={16} className="text-teal-600" />
          Previsão de consumo e compras
        </h2>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Insumo</th>
                  <th className="px-3 py-2 text-center">Estoque atual</th>
                  <th className="px-3 py-2 text-center">
                    Uso previsto agenda
                  </th>
                  <th className="px-3 py-2 text-center">
                    Saldo projetado
                  </th>
                  <th className="px-3 py-2 text-left">
                    Previsão de término
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {needs.map((item) => {
                  const finalStock =
                    item.currentStock - item.scheduledUsage;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-700">
                        <div className="font-semibold text-[11px]">
                          {item.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Mínimo: {item.minStock} {item.unit}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-600">
                        {item.currentStock}{" "}
                        <span className="text-[10px] text-slate-400">
                          {item.unit}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-600">
                        {item.scheduledUsage > 0 ? (
                          <>
                            -{item.scheduledUsage}{" "}
                            <span className="text-[10px] text-slate-400">
                              {item.unit}
                            </span>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            finalStock < 0
                              ? "bg-red-100 text-red-700"
                              : finalStock < item.minStock
                              ? "bg-amber-100 text-amber-700"
                              : "bg-teal-100 text-teal-700"
                          }`}
                        >
                          {finalStock} {item.unit}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {item.status === "critical" ? (
                          <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                            <CalendarClock size={12} />
                            {item.depletionDate
                              ? `Acaba em ${item.depletionDate.toLocaleDateString(
                                  "pt-BR"
                                )}`
                              : "Risco imediato"}
                          </span>
                        ) : item.status === "warning" ? (
                          <span className="text-amber-700 font-semibold">
                            Repor em breve
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-teal-700 font-semibold">
                            <CheckCircle size={12} />
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {needs.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-[11px] text-slate-400"
                    >
                      Nenhum insumo cadastrado para análise.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

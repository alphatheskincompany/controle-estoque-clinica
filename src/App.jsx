// ============================
// PARTE 1 - IMPORTS & SETUP
// ============================
import React, { useState, useEffect } from "react";
import {
  Activity,
  Users,
  Package,
  BarChart3,
  CheckCircle,
  AlertTriangle,
  Clock,
  Plus,
  Trash2,
  FileText,
  Upload,
  Search,
  History,
  X,
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
  query,
  orderBy,
  serverTimestamp,
  increment,
  Timestamp,
  writeBatch,
} from "firebase/firestore";


// ============================
// CONFIG FIREBASE (SEU PROJETO)
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
// COMPONENTE PRINCIPAL
// ============================
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  const [activeTab, setActiveTab] = useState("agenda"); // agenda | estoque | compras | pacientes
  const [inventory, setInventory] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [stockLogs, setStockLogs] = useState([]);

  // ----------------- AUTENTICAÇÃO -----------------
  useEffect(() => {
    signInAnonymously(auth)
      .catch((error) => {
        console.error("Erro no login anônimo:", error);
        setErrorMsg("Erro ao autenticar: " + error.message);
        setLoading(false);
      });

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      if (!u) setLoading(false);
    });

    return () => unsub();
  }, []);

  // ----------------- LISTENERS FIRESTORE -----------------
  useEffect(() => {
    if (!user) return;

    const handleError = (source, err) => {
      console.error(`Erro em ${source}:`, err);
      setErrorMsg(`Erro ao carregar ${source}: ${err.message}`);
      setLoading(false);
    };

    const invRef = collection(db, "inventory");
    const schedRef = collection(db, "schedule");
    const logsRef = collection(db, "stock_logs");

    const unsubInv = onSnapshot(
      invRef,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setInventory(arr);
      },
      (err) => handleError("estoque", err)
    );

    const unsubSched = onSnapshot(
      query(schedRef, orderBy("date")),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSchedule(arr);
        setLoading(false);
      },
      (err) => handleError("agenda", err)
    );

    const unsubLogs = onSnapshot(
      logsRef,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setStockLogs(
          arr.sort(
            (a, b) =>
              (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
          )
        );
      },
      (err) => handleError("logs", err)
    );

    return () => {
      unsubInv();
      unsubSched();
      unsubLogs();
    };
  }, [user]);

  // ============================
  // HANDLERS - ESTOQUE
  // ============================
  const handleAddInventory = async (item) => {
    if (!user) return;
    try {
      await addDoc(collection(db, "inventory"), {
        ...item,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Erro ao adicionar insumo:", e);
      alert("Erro ao salvar insumo.");
    }
  };

  const handleImportCSVInventory = async (csvText) => {
    if (!user) return;
    try {
      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        alert("Arquivo vazio.");
        return;
      }

      const batch = writeBatch(db);
      let count = 0;

      lines.forEach((line) => {
        const cols = line.split(",").map((c) => c.trim());
        if (cols.length < 3) return;

        const [name, unit, qtyStr, minStr] = cols;
        const quantity = Number(qtyStr) || 0;
        const minStock = Number(minStr) || 5;

        const ref = doc(collection(db, "inventory"));
        batch.set(ref, {
          name,
          unit: unit || "un",
          quantity,
          minStock,
          createdAt: serverTimestamp(),
        });
        count++;
      });

      if (count > 0) {
        await batch.commit();
        alert(`${count} insumos importados com sucesso!`);
      } else {
        alert("Nenhum insumo válido encontrado no arquivo.");
      }
    } catch (e) {
      console.error("Erro na importação", e);
      alert("Erro ao importar insumos. Verifique o arquivo.");
    }
  };

  const handleImportCSVAgenda = async (csvText) => {
    if (!user) return;
    try {
      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        alert("Arquivo de agenda vazio.");
        return;
      }

      const batch = writeBatch(db);
      let created = 0;
      const notFound = new Set();

      lines.forEach((line) => {
        const cols = line.split(",").map((c) => c.trim());
        if (cols.length < 4) return;

        const [patientName, itemName, doseStr, dateStr] = cols;
        const invItem = inventory.find(
          (i) => i.name.toLowerCase() === itemName.toLowerCase()
        );
        if (!invItem) {
          notFound.add(itemName);
          return;
        }

        const dose = Number(doseStr);
        if (!dose || !dateStr) return;

        const d = new Date(dateStr + "T00:00:00");
        if (isNaN(d.getTime())) return;

        const ts = Timestamp.fromDate(d);
        const ref = doc(collection(db, "schedule"));
        batch.set(ref, {
          patientName,
          items: [{ medicationId: invItem.id, dose }],
          date: ts,
          status: "scheduled",
          sessions: 1,
          sessionIndex: 1,
          createdAt: serverTimestamp(),
        });
        created++;
      });

      if (created > 0) {
        await batch.commit();
      }

      let msg = `${created} agendamentos importados.`;
      if (notFound.size > 0) {
        msg +=
          "\nInsumos não encontrados no estoque: " +
          Array.from(notFound).join(", ");
      }
      alert(msg);
    } catch (e) {
      console.error("Erro ao importar agenda", e);
      alert("Erro ao importar agenda. Verifique o arquivo.");
    }
  };

  const handleUpdateStock = async (id, quantityToAdd, itemName) => {
    if (!user) return;
    try {
      const qty = Number(quantityToAdd);
      const ref = doc(db, "inventory", id);

      await updateDoc(ref, {
        quantity: increment(qty),
      });

      await addDoc(collection(db, "stock_logs"), {
        itemId: id,
        itemName,
        quantity: qty,
        type: "entry",
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Erro ao atualizar estoque", e);
      alert("Erro ao atualizar estoque.");
    }
  };

  const handleDeleteInventory = async (id) => {
    if (!user) return;
    if (!window.confirm("Deseja realmente excluir este insumo?")) return;
    try {
      await deleteDoc(doc(db, "inventory", id));
    } catch (e) {
      console.error("Erro ao excluir insumo", e);
      alert("Erro ao excluir.");
    }
  };

  // ============================
  // HANDLERS - AGENDA / PACIENTES
  // ============================
  const handleSchedulePatient = async (data) => {
    if (!user) return;
    try {
      await addDoc(collection(db, "schedule"), {
        ...data,
        status: "scheduled",
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Erro ao agendar", e);
      alert("Erro ao agendar protocolo.");
    }
  };

  const handleApply = async (appointment, actualDate) => {
    if (!user) return;
    try {
      const itemsToProcess = appointment.items || [];
      if (itemsToProcess.length === 0) return;

      // valida estoque
      for (const it of itemsToProcess) {
        const stockItem = inventory.find((i) => i.id === it.medicationId);
        if (!stockItem) {
          alert("Insumo não encontrado no estoque.");
          return;
        }
        if (stockItem.quantity < Number(it.dose)) {
          alert(
            `Estoque insuficiente de ${stockItem.name}. Atual: ${stockItem.quantity}, necessário: ${it.dose}`
          );
          return;
        }
      }

      const d = new Date(actualDate + "T00:00:00");
      const ts = Timestamp.fromDate(d);

      const batch = writeBatch(db);

      itemsToProcess.forEach((it) => {
        const itemRef = doc(db, "inventory", it.medicationId);
        batch.update(itemRef, {
          quantity: increment(-Number(it.dose)),
        });

        const logRef = doc(collection(db, "stock_logs"));
        const stockItem = inventory.find((i) => i.id === it.medicationId);
        batch.set(logRef, {
          itemId: it.medicationId,
          itemName: stockItem?.name || "Aplicação",
          quantity: Number(it.dose),
          type: "usage",
          createdAt: serverTimestamp(),
        });
      });

      const schedRef = doc(db, "schedule", appointment.id);
      batch.update(schedRef, {
        status: "applied",
        appliedAt: ts,
      });

      await batch.commit();
    } catch (e) {
      console.error("Erro ao aplicar", e);
      alert("Erro ao registrar aplicação.");
    }
  };

  const handleUndoApply = async (appointment) => {
    if (!user) return;
    if (
      !window.confirm(
        `Deseja desfazer a aplicação para ${appointment.patientName}?`
      )
    )
      return;

    try {
      const itemsToProcess = appointment.items || [];
      const batch = writeBatch(db);

      itemsToProcess.forEach((it) => {
        const itemRef = doc(db, "inventory", it.medicationId);
        batch.update(itemRef, {
          quantity: increment(Number(it.dose)),
        });

        const logRef = doc(collection(db, "stock_logs"));
        const stockItem = inventory.find((i) => i.id === it.medicationId);
        batch.set(logRef, {
          itemId: it.medicationId,
          itemName: stockItem?.name || "Estorno",
          quantity: Number(it.dose),
          type: "reversal",
          createdAt: serverTimestamp(),
        });
      });

      const schedRef = doc(db, "schedule", appointment.id);
      batch.update(schedRef, {
        status: "scheduled",
        appliedAt: null,
      });

      await batch.commit();
    } catch (e) {
      console.error("Erro ao desfazer", e);
      alert("Erro ao desfazer aplicação.");
    }
  };

  const handleDeleteSchedule = async (id) => {
    if (!user) return;
    if (!window.confirm("Excluir este agendamento?")) return;
    try {
      await deleteDoc(doc(db, "schedule", id));
    } catch (e) {
      console.error("Erro ao excluir agendamento", e);
      alert("Erro ao excluir agendamento.");
    }
  };

  // ============================
  // MÉTRICAS DO HEADER
  // ============================
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pendingCount = schedule.filter((s) => s.status === "scheduled").length;
  const appliedToday = schedule.filter(
    (s) =>
      s.status === "applied" &&
      s.appliedAt?.seconds * 1000 >= today.getTime()
  ).length;
  const criticalStock = inventory.filter(
    (i) => i.quantity <= (i.minStock || 0)
  ).length;

  // ============================
  // TELAS DE LOADING / ERRO
  // ============================
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-slate-600">
        <div className="animate-spin w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full"></div>
        <p className="mt-3 text-sm">Carregando sistema...</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center px-6 bg-red-50">
        <AlertTriangle size={40} className="mb-4 text-red-500" />
        <h2 className="font-bold text-xl text-red-700 mb-2">
          Erro ao carregar dados
        </h2>
        <p className="text-sm text-red-700 bg-white border border-red-200 rounded-lg p-3">
          {errorMsg}
        </p>
        <button
          className="mt-4 px-4 py-2 rounded-lg bg-red-600 text-white"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // ============================
  // LAYOUT PRINCIPAL
  // ============================
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-20 md:pb-0">
      {/* HEADER */}
      <header className="bg-white shadow-sm border-b border-slate-200 p-4 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-teal-600 p-2 rounded-lg shadow">
              <Activity className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              Clinic<span className="text-teal-600">Control</span>
            </h1>
          </div>

          <nav className="hidden md:flex gap-2">
            <NavButton
              label="Enfermaria"
              icon={<Users size={18} />}
              active={activeTab === "agenda"}
              onClick={() => setActiveTab("agenda")}
            />
            <NavButton
              label="Estoque"
              icon={<Package size={18} />}
              active={activeTab === "estoque"}
              onClick={() => setActiveTab("estoque")}
            />
            <NavButton
              label="Planejamento"
              icon={<BarChart3 size={18} />}
              active={activeTab === "compras"}
              onClick={() => setActiveTab("compras")}
            />
            <NavButton
              label="Pacientes"
              icon={<FileText size={18} />}
              active={activeTab === "pacientes"}
              onClick={() => setActiveTab("pacientes")}
            />
          </nav>
        </div>
      </header>

      {/* MÉTRICAS */}
      <section className="max-w-6xl mx-auto px-4 mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Fila */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-amber-100 text-amber-700 p-3 rounded-full">
            <Clock size={26} />
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-amber-700">
              Fila de Aplicação
            </p>
            <h2 className="text-3xl font-black text-amber-800">
              {pendingCount}
            </h2>
          </div>
        </div>

        {/* Aplicados hoje */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-teal-100 text-teal-700 p-3 rounded-full">
            <CheckCircle size={26} />
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-teal-700">
              Aplicados Hoje
            </p>
            <h2 className="text-3xl font-black text-teal-800">
              {appliedToday}
            </h2>
          </div>
        </div>

        {/* Insumos críticos */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-red-100 text-red-700 p-3 rounded-full">
            <AlertTriangle size={26} />
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-red-700">
              Insumos Críticos
            </p>
            <h2 className="text-3xl font-black text-red-800">
              {criticalStock}
            </h2>
          </div>
        </div>
      </section>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="max-w-6xl mx-auto p-4 md:p-6 mt-4">
        {activeTab === "agenda" && (
          <ScheduleTab
            inventory={inventory}
            schedule={schedule}
            onSchedule={handleSchedulePatient}
            onApply={handleApply}
            onUndo={handleUndoApply}
            onDelete={handleDeleteSchedule}
          />
        )}

        {activeTab === "estoque" && (
          <InventoryTab
            inventory={inventory}
            stockLogs={stockLogs}
            onAdd={handleAddInventory}
            onImport={handleImportCSVInventory}
            onImportAgenda={handleImportCSVAgenda}
            onUpdateStock={handleUpdateStock}
            onDelete={handleDeleteInventory}
          />
        )}

        {activeTab === "compras" && (
          <DashboardTab inventory={inventory} schedule={schedule} />
        )}

        {activeTab === "pacientes" && (
          <PatientsTab
            schedule={schedule}
            inventory={inventory}
            onSchedule={handleSchedulePatient}
            onApply={handleApply}
            onUndo={handleUndoApply}
          />
        )}
      </main>

      {/* NAV MOBILE */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-2 flex justify-around shadow-lg z-50">
        <MobileNav
          label="Agenda"
          icon={<Users size={20} />}
          active={activeTab === "agenda"}
          onClick={() => setActiveTab("agenda")}
        />
        <MobileNav
          label="Estoque"
          icon={<Package size={20} />}
          active={activeTab === "estoque"}
          onClick={() => setActiveTab("estoque")}
        />
        <MobileNav
          label="Planejamento"
          icon={<BarChart3 size={20} />}
          active={activeTab === "compras"}
          onClick={() => setActiveTab("compras")}
        />
        <MobileNav
          label="Pacientes"
          icon={<FileText size={20} />}
          active={activeTab === "pacientes"}
          onClick={() => setActiveTab("pacientes")}
        />
      </div>
    </div>
  );
}


// ============================
// BOTÕES DE NAVEGAÇÃO
// ============================
function NavButton({ label, icon, active, onClick }) {
  return (
    <button
      className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${
        active
          ? "bg-teal-50 text-teal-700 border border-teal-200"
          : "text-slate-500 hover:bg-slate-100"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function MobileNav({ label, icon, active, onClick }) {
  return (
    <button
      className={`flex flex-col items-center text-xs p-2 rounded-lg ${
        active ? "text-teal-600" : "text-slate-400"
      }`}
      onClick={onClick}
    >
      {icon}
      <span className="mt-1">{label}</span>
    </button>
  );
}
// ============================
// PARTE 2 - ABA ESTOQUE
// ============================

function InventoryTab({
  inventory,
  stockLogs,
  onAdd,
  onImport,
  onImportAgenda,
  onUpdateStock,
  onDelete,
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showImportStock, setShowImportStock] = useState(false);
  const [showImportAgenda, setShowImportAgenda] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [newItem, setNewItem] = useState({
    name: "",
    unit: "ml",
    quantity: "",
    minStock: "",
  });

  const [selectedForEntry, setSelectedForEntry] = useState(null);
  const [entryQty, setEntryQty] = useState("");
  const [selectedForDelete, setSelectedForDelete] = useState(null);
  const [selectedForHistory, setSelectedForHistory] = useState(null);

  const filteredInventory = inventory.filter((i) =>
    i.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmitNewItem = (e) => {
    e.preventDefault();
    if (!newItem.name.trim()) return;

    onAdd({
      name: newItem.name.trim(),
      unit: newItem.unit,
      quantity: Number(newItem.quantity) || 0,
      minStock: Number(newItem.minStock) || 0,
    });

    setNewItem({ name: "", unit: "ml", quantity: "", minStock: "" });
    setShowAdd(false);
  };

  const handleStockFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onImport(ev.target.result);
      setShowImportStock(false);
    };
    reader.readAsText(file);
  };

  const handleAgendaFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onImportAgenda(ev.target.result);
      setShowImportAgenda(false);
    };
    reader.readAsText(file);
  };

  const confirmEntry = () => {
    if (!selectedForEntry) return;
    const qty = Number(entryQty);
    if (!qty) return;
    onUpdateStock(selectedForEntry.id, qty, selectedForEntry.name);
    setSelectedForEntry(null);
    setEntryQty("");
  };

  const confirmDelete = () => {
    if (!selectedForDelete) return;
    onDelete(selectedForDelete.id);
    setSelectedForDelete(null);
  };

  const logsForSelected =
    selectedForHistory == null
      ? []
      : stockLogs.filter((l) => l.itemId === selectedForHistory.id);

  return (
    <div className="space-y-6">
      {/* CABEÇALHO DA ABA */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2">
            <Package className="text-teal-600" size={18} />
            Estoque de Insumos
          </h2>
          <p className="text-xs text-slate-500">
            Cadastre, importe, acompanhe níveis e movimentos do estoque.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <div className="relative flex-1 min-w-[180px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Buscar insumo..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <button
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white flex items-center gap-1 text-slate-600 hover:bg-slate-50"
            onClick={() => setShowImportStock(true)}
          >
            <Upload size={14} /> Importar insumos
          </button>

          <button
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white flex items-center gap-1 text-slate-600 hover:bg-slate-50"
            onClick={() => setShowImportAgenda(true)}
          >
            <Upload size={14} /> Importar agenda
          </button>

          <button
            className="px-3 py-2 text-xs rounded-lg bg-teal-600 text-white flex items-center gap-1 hover:bg-teal-700"
            onClick={() => setShowAdd((v) => !v)}
          >
            <Plus size={14} /> Novo insumo
          </button>
        </div>
      </div>

      {/* FORM NOVO INSUMO */}
      {showAdd && (
        <form
          onSubmit={handleSubmitNewItem}
          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4"
        >
          <p className="text-sm font-semibold text-slate-700">
            Cadastrar novo insumo
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <div className="md:col-span-2">
              <label className="block text-slate-500 mb-1">Nome</label>
              <input
                type="text"
                required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                placeholder="Ex: Laennec"
                value={newItem.name}
                onChange={(e) =>
                  setNewItem((old) => ({ ...old, name: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">Unidade</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                value={newItem.unit}
                onChange={(e) =>
                  setNewItem((old) => ({ ...old, unit: e.target.value }))
                }
              >
                <option value="ml">ml</option>
                <option value="mg">mg</option>
                <option value="un">un</option>
                <option value="amp">amp</option>
                <option value="fr">fr</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-500 mb-1">
                Estoque inicial
              </label>
              <input
                type="number"
                required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                value={newItem.quantity}
                onChange={(e) =>
                  setNewItem((old) => ({ ...old, quantity: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">
                Estoque mínimo
              </label>
              <input
                type="number"
                required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                value={newItem.minStock}
                onChange={(e) =>
                  setNewItem((old) => ({ ...old, minStock: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
              onClick={() => setShowAdd(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700"
            >
              Salvar insumo
            </button>
          </div>
        </form>
      )}

      {/* GRID DE INSUMOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredInventory.map((item) => {
          const critical = item.quantity <= (item.minStock || 0);
          return (
            <div
              key={item.id}
              className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between relative"
            >
              <div
                className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${
                  critical ? "bg-red-500" : "bg-teal-500"
                }`}
              />
              <div>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-slate-700 text-sm pr-4">
                    {item.name}
                  </h3>
                  <div className="flex gap-1">
                    <button
                      className="p-1 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded"
                      title="Histórico"
                      onClick={() => setSelectedForHistory(item)}
                    >
                      <History size={14} />
                    </button>
                    <button
                      className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Excluir"
                      onClick={() => setSelectedForDelete(item)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-3xl font-black ${
                      critical ? "text-red-600" : "text-slate-800"
                    }`}
                  >
                    {item.quantity}
                  </span>
                  <span className="text-xs text-slate-500">{item.unit}</span>
                </div>

                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  {critical && (
                    <AlertTriangle size={11} className="text-red-500" />
                  )}
                  Mínimo: {item.minStock} {item.unit}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100">
                <button
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-teal-50 hover:border-teal-200 flex items-center justify-center gap-1"
                  onClick={() => setSelectedForEntry(item)}
                >
                  <Plus size={12} /> Entrada de estoque
                </button>
              </div>
            </div>
          );
        })}

        {filteredInventory.length === 0 && (
          <div className="col-span-full bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-slate-400 text-sm">
            Nenhum insumo encontrado.
          </div>
        )}
      </div>

      {/* MODAL IMPORTAR INSUMOS */}
      {showImportStock && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Importar insumos (.csv)
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setShowImportStock(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Formato esperado: <br />
              <code className="bg-slate-50 px-1 py-0.5 rounded">
                Nome, Unidade, Quantidade, Minimo
              </code>
            </p>
            <div className="border border-dashed border-slate-300 rounded-lg p-6 text-center text-xs text-slate-500 bg-slate-50">
              <Upload size={18} className="mx-auto mb-2 text-slate-400" />
              <p className="mb-1">Selecione o arquivo CSV do seu computador</p>
              <input
                type="file"
                accept=".csv"
                className="mt-2 text-xs"
                onChange={handleStockFileChange}
              />
            </div>
            <button
              className="mt-4 w-full text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
              onClick={() => setShowImportStock(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* MODAL IMPORTAR AGENDA */}
      {showImportAgenda && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Importar agenda (.csv)
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setShowImportAgenda(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Formato esperado: <br />
              <code className="bg-slate-50 px-1 py-0.5 rounded">
                Paciente, NomeInsumo, Dose, YYYY-MM-DD
              </code>
              <br />
              O nome do insumo deve ser exatamente igual ao cadastrado no
              estoque.
            </p>
            <div className="border border-dashed border-slate-300 rounded-lg p-6 text-center text-xs text-slate-500 bg-slate-50">
              <Upload size={18} className="mx-auto mb-2 text-slate-400" />
              <p className="mb-1">Selecione o arquivo CSV do seu computador</p>
              <input
                type="file"
                accept=".csv"
                className="mt-2 text-xs"
                onChange={handleAgendaFileChange}
              />
            </div>
            <button
              className="mt-4 w-full text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
              onClick={() => setShowImportAgenda(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* MODAL ENTRADA DE ESTOQUE */}
      {selectedForEntry && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Entrada de estoque
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => {
                  setSelectedForEntry(null);
                  setEntryQty("");
                }}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Insumo:{" "}
              <span className="font-semibold text-slate-700">
                {selectedForEntry.name}
              </span>
            </p>
            <label className="block text-[11px] text-slate-500 mb-1">
              Quantidade ({selectedForEntry.unit})
            </label>
            <input
              type="number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={entryQty}
              onChange={(e) => setEntryQty(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => {
                  setSelectedForEntry(null);
                  setEntryQty("");
                }}
              >
                Cancelar
              </button>
              <button
                className="flex-1 text-xs px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                onClick={confirmEntry}
                disabled={!entryQty}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EXCLUIR */}
      {selectedForDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Excluir insumo
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setSelectedForDelete(null)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Tem certeza que deseja excluir o insumo{" "}
              <span className="font-semibold text-slate-700">
                {selectedForDelete.name}
              </span>
              ?
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => setSelectedForDelete(null)}
              >
                Cancelar
              </button>
              <button
                className="flex-1 text-xs px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
                onClick={confirmDelete}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL HISTÓRICO */}
      {selectedForHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">
                  Histórico de movimentos
                </h3>
                <p className="text-[11px] text-slate-500">
                  {selectedForHistory.name}
                </p>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setSelectedForHistory(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {logsForSelected.length === 0 && (
                <p className="text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center">
                  Nenhum movimento registrado para este insumo.
                </p>
              )}

              {logsForSelected.map((log) => {
                const created =
                  log.createdAt?.seconds != null
                    ? new Date(log.createdAt.seconds * 1000)
                    : null;

                let tipo = "Entrada";
                let cor = "text-teal-700 bg-teal-50";
                if (log.type === "usage") {
                  tipo = "Uso em aplicação";
                  cor = "text-slate-700 bg-slate-50";
                }
                if (log.type === "reversal") {
                  tipo = "Estorno";
                  cor = "text-amber-700 bg-amber-50";
                }

                return (
                  <div
                    key={log.id}
                    className="border border-slate-100 rounded-lg p-3 text-xs flex justify-between items-center"
                  >
                    <div>
                      <p className="font-semibold text-slate-700">
                        {tipo}{" "}
                        <span className="text-slate-500 font-normal">
                          (+{log.quantity} {selectedForHistory.unit})
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
                        <Clock size={10} />{" "}
                        {created
                          ? created.toLocaleString("pt-BR")
                          : "Data não registrada"}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cor}`}
                    >
                      {log.type}
                    </span>
                  </div>
                );
              })}
            </div>

            <button
              className="mt-3 w-full text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
              onClick={() => setSelectedForHistory(null)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
// ============================
// HELPER PARA TRATAR CAMPOS DE DATA
// ============================
function getScheduleDate(rec) {
  if (!rec) return null;
  const d = rec.date;

  // Timestamp do Firestore
  if (d instanceof Timestamp) return d.toDate();
  if (d?.seconds != null) return new Date(d.seconds * 1000);

  // String "YYYY-MM-DD"
  if (typeof d === "string") return new Date(d + "T00:00:00");

  // Date direto
  if (d instanceof Date) return d;

  return null;
}

// ============================
// PARTE 3 - ABA ENFERMARIA / AGENDA
// ============================
function ScheduleTab({
  inventory,
  schedule,
  onSchedule,
  onApply,
  onUndo,
  onDelete,
}) {
  const [patientName, setPatientName] = useState("");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [sessions, setSessions] = useState(1);
  const [items, setItems] = useState([
    { id: Date.now(), medicationId: "", dose: "" },
  ]);

  const [applyRecord, setApplyRecord] = useState(null);
  const [applyDate, setApplyDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  // Pendentes e histórico
  const pending = schedule.filter((s) => s.status === "scheduled");
  const applied = schedule
    .filter((s) => s.status === "applied")
    .sort((a, b) => {
      const da = a.appliedAt?.seconds || 0;
      const db = b.appliedAt?.seconds || 0;
      return db - da;
    });

  // --------- gestão das linhas de insumos no formulário ----------
  const addLine = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), medicationId: "", dose: "" },
    ]);
  };

  const updateLine = (id, field, value) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    );
  };

  const removeLine = (id) => {
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((it) => it.id !== id)
    );
  };

  // --------- submit do agendamento ----------
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!patientName.trim()) {
      alert("Informe o nome do paciente.");
      return;
    }

    const cleanItems = items
      .filter((it) => it.medicationId && it.dose)
      .map(({ id, ...rest }) => rest);

    if (cleanItems.length === 0) {
      alert("Informe ao menos um insumo e dose.");
      return;
    }

    const totalSessions = Math.max(1, Number(sessions) || 1);
    const base = new Date(startDate + "T00:00:00");

    for (let idx = 0; idx < totalSessions; idx++) {
      const d = new Date(base);
      d.setDate(base.getDate() + idx * 7); // semanal
      const ts = Timestamp.fromDate(d);

      await onSchedule({
        patientName: patientName.trim(),
        items: cleanItems,
        date: ts,
        sessions: totalSessions,
        sessionIndex: idx + 1,
      });
    }

    // limpa formulário
    setPatientName("");
    setStartDate(new Date().toISOString().split("T")[0]);
    setSessions(1);
    setItems([{ id: Date.now(), medicationId: "", dose: "" }]);
  };

  // --------- aplicar / desfazer ----------
  const openApplyModal = (record) => {
    setApplyRecord(record);
    setApplyDate(new Date().toISOString().split("T")[0]);
  };

  const confirmApply = async () => {
    if (!applyRecord || !applyDate) return;
    await onApply(applyRecord, applyDate);
    setApplyRecord(null);
  };

  const handleUndoClick = async (rec) => {
    await onUndo(rec);
  };

  // --------- render ----------
  const renderMedsSummary = (rec) => {
    const meds = (rec.items || []).map((it) => {
      const inv = inventory.find((i) => i.id === it.medicationId);
      return {
        ...it,
        name: inv?.name || "Insumo removido",
        unit: inv?.unit || "",
      };
    });

    return (
      <ul className="mt-1 text-xs text-slate-600 space-y-0.5">
        {meds.map((m, idx) => (
          <li key={idx}>
            • {m.name} —{" "}
            <span className="font-semibold">
              {m.dose} {m.unit}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  const isLate = (rec) => {
    const d = getScheduleDate(rec);
    if (!d) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return d.getTime() < today.getTime();
  };

  return (
    <div className="space-y-6">
      {/* FORMULÁRIO DE AGENDAMENTO */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Users size={16} className="text-teal-600" />
          Agendar protocolo
        </h2>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs"
        >
          <div className="md:col-span-12">
            <label className="block text-slate-500 mb-1">
              Nome do paciente
            </label>
            <input
              type="text"
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              placeholder="Nome completo"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />
          </div>

          <div className="md:col-span-12 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-slate-600">
                Insumos do protocolo
              </p>
              <button
                type="button"
                className="text-[11px] text-teal-700 hover:underline flex items-center gap-1"
                onClick={addLine}
              >
                <Plus size={10} /> Adicionar insumo
              </button>
            </div>

            {items.map((it) => (
              <div
                key={it.id}
                className="flex items-center gap-2 mb-2 text-xs"
              >
                <select
                  className="flex-1 border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/20 bg-white"
                  value={it.medicationId}
                  onChange={(e) =>
                    updateLine(it.id, "medicationId", e.target.value)
                  }
                  required
                >
                  <option value="">Selecione o insumo...</option>
                  {inventory.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name} ({inv.unit})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.1"
                  className="w-24 border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  placeholder="Dose"
                  value={it.dose}
                  onChange={(e) => updateLine(it.id, "dose", e.target.value)}
                  required
                />
                {items.length > 1 && (
                  <button
                    type="button"
                    className="p-1 text-red-500 hover:bg-red-50 rounded"
                    onClick={() => removeLine(it.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="md:col-span-6">
            <label className="block text-slate-500 mb-1">Data inicial</label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

          <div className="md:col-span-6">
            <label className="block text-slate-500 mb-1">
              Repetições semanais
            </label>
            <input
              type="number"
              min={1}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
            />
          </div>

          <div className="md:col-span-12 mt-2">
            <button
              type="submit"
              className="w-full bg-teal-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-teal-700"
            >
              Agendar protocolo
            </button>
          </div>
        </form>
      </section>

      {/* LISTAS: FILA DE APLICAÇÃO & HISTÓRICO */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* FILA */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              Fila de aplicação
            </h3>
            <span className="text-[11px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold">
              {pending.length} pendente(s)
            </span>
          </div>

          {pending.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">
              Nenhum paciente na fila.
            </p>
          )}

          <div className="space-y-3 max-h-[420px] overflow-y-auto">
            {pending.map((rec) => {
              const d = getScheduleDate(rec);
              const atrasado = isLate(rec);
              return (
                <div
                  key={rec.id}
                  className="border border-slate-100 rounded-lg p-3 text-xs flex justify-between items-start gap-3 hover:bg-slate-50"
                >
                  <div>
                    <p className="font-semibold text-slate-700">
                      {rec.patientName}{" "}
                      {rec.sessionIndex && rec.sessions && (
                        <span className="text-[10px] text-slate-500 ml-1">
                          ({rec.sessionIndex}/{rec.sessions})
                        </span>
                      )}
                    </p>
                    {renderMedsSummary(rec)}
                    <p
                      className={`mt-1 text-[11px] flex items-center gap-1 ${
                        atrasado ? "text-red-600" : "text-slate-400"
                      }`}
                    >
                      {atrasado && (
                        <AlertTriangle size={10} className="text-red-500" />
                      )}
                      Agendado:{" "}
                      {d ? d.toLocaleDateString("pt-BR") : "sem data"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex gap-1">
                      <button
                        className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Excluir agendamento"
                        onClick={() => onDelete(rec.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <button
                      className="mt-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700"
                      onClick={() => openApplyModal(rec)}
                    >
                      Aplicar agora
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* HISTÓRICO */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-300" />
              Histórico recente
            </h3>
          </div>

          {applied.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">
              Nenhuma aplicação registrada.
            </p>
          )}

          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {applied.slice(0, 15).map((rec) => {
              const appliedAt =
                rec.appliedAt?.seconds != null
                  ? new Date(rec.appliedAt.seconds * 1000)
                  : null;

              return (
                <div
                  key={rec.id}
                  className="border border-slate-100 rounded-lg p-3 text-xs flex justify-between items-center hover:bg-slate-50"
                >
                  <div>
                    <p className="font-semibold text-slate-700">
                      {rec.patientName}{" "}
                      {rec.sessionIndex && rec.sessions && (
                        <span className="text-[10px] text-slate-500 ml-1">
                          ({rec.sessionIndex}/{rec.sessions})
                        </span>
                      )}
                    </p>
                    {renderMedsSummary(rec)}
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <CheckCircle size={12} className="text-teal-500" />
                      <span className="text-[10px] text-teal-700 font-semibold">
                        Aplicado
                      </span>
                    </div>
                    {appliedAt && (
                      <p className="text-[10px] text-slate-400">
                        {appliedAt.toLocaleDateString("pt-BR")}{" "}
                        {appliedAt.toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                    <button
                      className="mt-1 text-[11px] text-amber-700 hover:underline"
                      onClick={() => handleUndoClick(rec)}
                    >
                      Desfazer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* MODAL APLICAR */}
      {applyRecord && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Confirmar aplicação
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Paciente:{" "}
              <span className="font-semibold text-slate-700">
                {applyRecord.patientName}
              </span>
            </p>

            <label className="block text-[11px] text-slate-500 mb-1">
              Data real da aplicação
            </label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={applyDate}
              onChange={(e) => setApplyDate(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => setApplyRecord(null)}
              >
                Cancelar
              </button>
              <button
                className="flex-1 text-xs px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
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
function PatientsTab({ schedule, inventory, onSchedule, onApply, onUndo }) {
  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(null);

  // modal nova aplicação
  const [newAppOpen, setNewAppOpen] = useState(false);
  const [newAppDate, setNewAppDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [newAppSessions, setNewAppSessions] = useState(1);
  const [newAppItems, setNewAppItems] = useState([
    { id: Date.now(), medicationId: "", dose: "" },
  ]);

  // modal aplicar
  const [applyRecord, setApplyRecord] = useState(null);
  const [applyDate, setApplyDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  // lista única de pacientes
  const patients = Array.from(
    new Set(
      schedule.map((s) => (s.patientName || "").trim()).filter(Boolean)
    )
  ).sort();

  const filteredPatients = patients.filter((p) =>
    p.toLowerCase().includes(search.toLowerCase())
  );

  const recordsForSelected =
    selectedPatient == null
      ? []
      : schedule
          .filter((s) => s.patientName === selectedPatient)
          .sort((a, b) => {
            const da = getScheduleDate(a)?.getTime() || 0;
            const db = getScheduleDate(b)?.getTime() || 0;
            return da - db;
          });

  // -------- NOVA APLICAÇÃO (form dentro do paciente) --------
  const addNewAppLine = () => {
    setNewAppItems((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), medicationId: "", dose: "" },
    ]);
  };

  const updateNewAppLine = (id, field, value) => {
    setNewAppItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    );
  };

  const removeNewAppLine = (id) => {
    setNewAppItems((prev) =>
      prev.length === 1 ? prev : prev.filter((it) => it.id !== id)
    );
  };

  const handleCreateNewApplication = async (e) => {
    e.preventDefault();
    if (!selectedPatient) {
      alert("Selecione um paciente primeiro.");
      return;
    }

    const cleanItems = newAppItems
      .filter((it) => it.medicationId && it.dose)
      .map(({ id, ...rest }) => rest);

    if (cleanItems.length === 0) {
      alert("Informe ao menos um insumo e dose.");
      return;
    }

    const totalSessions = Math.max(1, Number(newAppSessions) || 1);
    const base = new Date(newAppDate + "T00:00:00");

    for (let idx = 0; idx < totalSessions; idx++) {
      const d = new Date(base);
      d.setDate(base.getDate() + idx * 7);
      const ts = Timestamp.fromDate(d);

      await onSchedule({
        patientName: selectedPatient,
        items: cleanItems,
        date: ts,
        sessions: totalSessions,
        sessionIndex: idx + 1,
      });
    }

    setNewAppOpen(false);
    setNewAppDate(new Date().toISOString().split("T")[0]);
    setNewAppSessions(1);
    setNewAppItems([{ id: Date.now(), medicationId: "", dose: "" }]);
  };

  // -------- APLICAR / DESFAZER --------
  const openApplyModal = (rec) => {
    setApplyRecord(rec);
    setApplyDate(new Date().toISOString().split("T")[0]);
  };

  const confirmApply = async () => {
    if (!applyRecord || !applyDate) return;
    await onApply(applyRecord, applyDate);
    setApplyRecord(null);
  };

  const handleUndoClick = async (rec) => {
    if (!window.confirm("Deseja desfazer esta aplicação?")) return;
    await onUndo(rec);
  };

  const renderMedsSummary = (rec) => {
    const meds = (rec.items || []).map((it) => {
      const inv = inventory.find((i) => i.id === it.medicationId);
      return {
        ...it,
        name: inv?.name || "Insumo removido",
        unit: inv?.unit || "",
      };
    });

    return (
      <ul className="mt-1 text-xs text-slate-600 space-y-0.5">
        {meds.map((m, idx) => (
          <li key={idx}>
            • {m.name} —{" "}
            <span className="font-semibold">
              {m.dose} {m.unit}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* COLUNA DE PACIENTES */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm lg:col-span-1">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Users size={16} className="text-teal-600" />
          Pacientes
        </h2>

        <div className="relative mb-3">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Buscar paciente..."
            className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="max-h-[380px] overflow-y-auto space-y-1">
          {filteredPatients.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">
              Nenhum paciente encontrado.
            </p>
          )}

          {filteredPatients.map((p) => (
            <button
              key={p}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs ${
                selectedPatient === p
                  ? "bg-teal-50 text-teal-700 font-semibold border border-teal-100"
                  : "hover:bg-slate-100 text-slate-600"
              }`}
              onClick={() => {
                setSelectedPatient(p);
                setNewAppOpen(false);
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* COLUNA DE HISTÓRICO / AÇÕES DO PACIENTE */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm lg:col-span-2">
        {!selectedPatient && (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">
            Selecione um paciente ao lado para ver e gerenciar o histórico.
          </div>
        )}

        {selectedPatient && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">
                  Histórico —{" "}
                  <span className="text-teal-700">{selectedPatient}</span>
                </h2>
                <p className="text-[11px] text-slate-400">
                  Visualize pendentes e aplicações já realizadas.
                </p>
              </div>
              <button
                className="px-3 py-2 text-[11px] rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1"
                onClick={() => setNewAppOpen(true)}
              >
                <Plus size={12} /> Nova aplicação
              </button>
            </div>

            {recordsForSelected.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">
                Nenhum registro encontrado para este paciente.
              </p>
            )}

            <div className="flex-1 max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {recordsForSelected.map((rec) => {
                const schedDate = getScheduleDate(rec);
                const appliedAt =
                  rec.appliedAt?.seconds != null
                    ? new Date(rec.appliedAt.seconds * 1000)
                    : null;

                const status =
                  rec.status === "applied"
                    ? "Aplicado"
                    : rec.status === "scheduled"
                    ? "Pendente"
                    : rec.status || "Pendente";

                return (
                  <div
                    key={rec.id}
                    className="py-3 flex justify-between items-start gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-700">
                        Sessão{" "}
                        {rec.sessionIndex && rec.sessions
                          ? `${rec.sessionIndex}/${rec.sessions}`
                          : "-"}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Agendado:{" "}
                        {schedDate
                          ? schedDate.toLocaleDateString("pt-BR")
                          : "Sem data"}
                      </p>
                      {appliedAt && (
                        <p className="text-[11px] text-slate-400">
                          Aplicado em:{" "}
                          {appliedAt.toLocaleDateString("pt-BR")}{" "}
                          {appliedAt.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                      {renderMedsSummary(rec)}
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          status === "Aplicado"
                            ? "bg-teal-50 text-teal-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {status}
                      </span>

                      {status === "Pendente" && (
                        <button
                          className="mt-1 text-[11px] text-teal-700 hover:underline"
                          onClick={() => openApplyModal(rec)}
                        >
                          Aplicar
                        </button>
                      )}

                      {status === "Aplicado" && (
                        <button
                          className="mt-1 text-[11px] text-amber-700 hover:underline"
                          onClick={() => handleUndoClick(rec)}
                        >
                          Desfazer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* MODAL - NOVA APLICAÇÃO */}
      {newAppOpen && selectedPatient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">
                  Nova aplicação
                </h3>
                <p className="text-[11px] text-slate-400">
                  Paciente:{" "}
                  <span className="font-semibold text-slate-700">
                    {selectedPatient}
                  </span>
                </p>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setNewAppOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={handleCreateNewApplication}
              className="space-y-4 text-xs"
            >
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-slate-600">
                    Insumos
                  </p>
                  <button
                    type="button"
                    className="text-[11px] text-teal-700 hover:underline flex items-center gap-1"
                    onClick={addNewAppLine}
                  >
                    <Plus size={10} /> Adicionar insumo
                  </button>
                </div>

                {newAppItems.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center gap-2 mb-2 text-xs"
                  >
                    <select
                      className="flex-1 border border-slate-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                      value={it.medicationId}
                      onChange={(e) =>
                        updateNewAppLine(
                          it.id,
                          "medicationId",
                          e.target.value
                        )
                      }
                      required
                    >
                      <option value="">Selecione o insumo...</option>
                      {inventory.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.name} ({inv.unit})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.1"
                      className="w-24 border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                      placeholder="Dose"
                      value={it.dose}
                      onChange={(e) =>
                        updateNewAppLine(it.id, "dose", e.target.value)
                      }
                      required
                    />
                    {newAppItems.length > 1 && (
                      <button
                        type="button"
                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                        onClick={() => removeNewAppLine(it.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Data inicial
                  </label>
                  <input
                    type="date"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    value={newAppDate}
                    onChange={(e) => setNewAppDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Repetições semanais
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    value={newAppSessions}
                    onChange={(e) => setNewAppSessions(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                  onClick={() => setNewAppOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 text-xs px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL - APLICAR PENDENTE */}
      {applyRecord && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Confirmar aplicação
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Paciente:{" "}
              <span className="font-semibold text-slate-700">
                {applyRecord.patientName}
              </span>
            </p>

            <label className="block text-[11px] text-slate-500 mb-1">
              Data real da aplicação
            </label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={applyDate}
              onChange={(e) => setApplyDate(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                onClick={() => setApplyRecord(null)}
              >
                Cancelar
              </button>
              <button
                className="flex-1 text-xs px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
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
// PARTE 4 - ABA PLANEJAMENTO / DASHBOARD
// ============================
function DashboardTab({ inventory, schedule }) {
  // monta análise simples de consumo previsto
  const analysisByItem = {};

  // inicializa com dados do estoque
  inventory.forEach((item) => {
    analysisByItem[item.id] = {
      id: item.id,
      name: item.name,
      unit: item.unit,
      currentStock: item.quantity || 0,
      minStock: item.minStock || 0,
      scheduledUsage: 0,
      usageByDate: [], // {date, amount}
    };
  });

  // varre agenda futura (pendentes)
  schedule
    .filter((s) => s.status === "scheduled")
    .forEach((s) => {
      const d = getScheduleDate(s);
      if (!d) return;

      (s.items || []).forEach((it) => {
        const bucket = analysisByItem[it.medicationId];
        if (!bucket) return;
        const dose = Number(it.dose) || 0;
        if (!dose) return;

        bucket.scheduledUsage += dose;
        bucket.usageByDate.push({
          date: d,
          amount: dose,
        });
      });
    });

  // calcula status e (opcional) data de ruptura
  const needs = Object.values(analysisByItem).map((item) => {
    const projected = item.currentStock - item.scheduledUsage;
    let status = "ok";
    if (projected < 0) status = "critical";
    else if (projected < item.minStock) status = "warning";

    let depletionDate = null;
    if (item.usageByDate.length > 0) {
      let tempStock = item.currentStock;
      const sorted = [...item.usageByDate].sort(
        (a, b) => a.date.getTime() - b.date.getTime()
      );
      for (const u of sorted) {
        tempStock -= u.amount;
        if (tempStock < 0) {
          depletionDate = u.date;
          break;
        }
      }
    }

    return {
      ...item,
      projected,
      status,
      depletionDate,
    };
  });

  // ordena por criticidade
  needs.sort((a, b) => {
    const order = { critical: 0, warning: 1, ok: 2 };
    return order[a.status] - order[b.status];
  });

  const countCritical = needs.filter((n) => n.status === "critical").length;
  const countWarning = needs.filter((n) => n.status === "warning").length;

  return (
    <div className="space-y-6">
      {/* RESUMO */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-3">
          <div className="bg-red-100 text-red-700 p-2 rounded-full">
            <AlertTriangle size={20} />
          </div>
          <div>
            <p className="text-[11px] uppercase font-semibold text-red-700">
              Risco de faltar
            </p>
            <p className="text-2xl font-black text-red-800">{countCritical}</p>
            <p className="text-[11px] text-red-700">
              Itens com agenda maior que estoque
            </p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center gap-3">
          <div className="bg-amber-100 text-amber-700 p-2 rounded-full">
            <Package size={20} />
          </div>
          <div>
            <p className="text-[11px] uppercase font-semibold text-amber-700">
              Atenção / reposição
            </p>
            <p className="text-2xl font-black text-amber-800">{countWarning}</p>
            <p className="text-[11px] text-amber-700">
              Abaixo do estoque mínimo com agenda futura
            </p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
          <div className="bg-slate-200 text-slate-700 p-2 rounded-full">
            <BarChart3 size={20} />
          </div>
          <div>
            <p className="text-[11px] uppercase font-semibold text-slate-600">
              Insumos cadastrados
            </p>
            <p className="text-2xl font-black text-slate-800">
              {inventory.length}
            </p>
            <p className="text-[11px] text-slate-500">
              Itens ativos no estoque
            </p>
          </div>
        </div>
      </section>

      {/* TABELA DETALHADA */}
      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <BarChart3 size={16} className="text-teal-600" />
          Previsão de consumo vs estoque
        </h2>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">
                  Insumo
                </th>
                <th className="text-center px-3 py-2 font-semibold text-slate-600">
                  Atual
                </th>
                <th className="text-center px-3 py-2 font-semibold text-slate-600">
                  Consumo agendado
                </th>
                <th className="text-center px-3 py-2 font-semibold text-slate-600">
                  Saldo projetado
                </th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">
                  Situação
                </th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">
                  Previsão de ruptura
                </th>
              </tr>
            </thead>
            <tbody>
              {needs.map((n) => (
                <tr
                  key={n.id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-2 text-slate-700">{n.name}</td>
                  <td className="px-3 py-2 text-center text-slate-600">
                    {n.currentStock}{" "}
                    <span className="text-[10px] text-slate-400">
                      {n.unit}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-slate-600">
                    {n.scheduledUsage > 0 ? (
                      <>
                        {n.scheduledUsage}{" "}
                        <span className="text-[10px] text-slate-400">
                          {n.unit}
                        </span>
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-[10px] font-semibold ${
                        n.projected < 0
                          ? "bg-red-100 text-red-700"
                          : n.projected < n.minStock
                          ? "bg-amber-100 text-amber-700"
                          : "bg-teal-100 text-teal-700"
                      }`}
                    >
                      {n.projected} {n.unit}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {n.status === "critical"
                      ? "Crítico"
                      : n.status === "warning"
                      ? "Atenção"
                      : "OK"}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {n.depletionDate && n.status === "critical"
                      ? n.depletionDate.toLocaleDateString("pt-BR")
                      : "-"}
                  </td>
                </tr>
              ))}

              {needs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-4 text-center text-slate-400"
                  >
                    Nenhum insumo encontrado para análise.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

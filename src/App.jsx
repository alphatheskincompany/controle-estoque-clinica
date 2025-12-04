// =====================================================================================
// PARTE 1 — IMPORTS, FIREBASE, ESTADOS, IMPORTADORES, FUNÇÕES GLOBAIS
// =====================================================================================

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
  Edit,
  FileText,
  Upload,
  Search,
  History,
  X
} from "lucide-react";

import { initializeApp } from "firebase/app";
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
  query,
  orderBy
} from "firebase/firestore";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "firebase/auth";


// =====================================================================================
// CONFIGURAÇÃO FIREBASE (mantém a sua)
// =====================================================================================

const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SUA_AUTH",
  projectId: "SUA_PROJECT",
  storageBucket: "SUA_BUCKET",
  messagingSenderId: "SUA_SENDER",
  appId: "SUA_APP_ID",
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);


// =====================================================================================
// COMPONENTE PRINCIPAL
// =====================================================================================

export default function ClinicStockApp() {

  // ===============================
  // ESTADOS GERAIS
  // ===============================
  const [user, setUser] = useState(null);

  const [activeTab, setActiveTab] = useState("agenda"); 
  // agenda | estoque | compras | pacientes (nova aba)

  const [inventory, setInventory] = useState([]);   // Insumos
  const [schedule, setSchedule] = useState([]);     // Agenda / Aplicações
  const [stockLogs, setStockLogs] = useState([]);   // Histórico de movimentação

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);


  // =====================================================================================
  // AUTENTICAÇÃO ANÔNIMA FIREBASE
  // =====================================================================================
  useEffect(() => {
    signInAnonymously(auth).catch((error) => {
      setErrorMsg("Erro ao autenticar: " + error.message);
      console.error(error);
    });

    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);


  // =====================================================================================
  // LISTENERS FIRESTORE (estoque, agenda, logs)
  // =====================================================================================
  useEffect(() => {
    if (!user) return;

    const unsubInventory = onSnapshot(
      collection(db, "inventory"),
      (snap) => {
        setInventory(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => setErrorMsg(err.message)
    );

    const unsubSchedule = onSnapshot(
      query(collection(db, "schedule"), orderBy("date")),
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setSchedule(items);
        setLoading(false);
      },
      (err) => setErrorMsg(err.message)
    );

    const unsubLogs = onSnapshot(
      collection(db, "stock_logs"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setStockLogs(
          arr.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        );
      }
    );

    return () => {
      unsubInventory();
      unsubSchedule();
      unsubLogs();
    };
  }, [user]);


  // =====================================================================================
  // FUNÇÕES — ESTOQUE
  // =====================================================================================

  // Adicionar insumo
  const handleAddInventory = async (item) => {
    try {
      await addDoc(collection(db, "inventory"), {
        ...item,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      alert("Erro ao adicionar item: " + e.message);
    }
  };

  // Deletar insumo
  const handleDeleteInventory = async (id) => {
    await deleteDoc(doc(db, "inventory", id));
  };

  // Atualizar quantidade (entrada)
  const handleUpdateStock = async (id, quantityToAdd, itemName) => {
    const itemRef = doc(db, "inventory", id);

    await updateDoc(itemRef, {
      quantity: increment(Number(quantityToAdd)),
    });

    await addDoc(collection(db, "stock_logs"), {
      itemId: id,
      itemName,
      quantity: Number(quantityToAdd),
      type: "entry",
      createdAt: serverTimestamp(),
    });
  };


  // =====================================================================================
  // IMPORTADOR CSV — INSUMOS (já existia, mantido)
  // =====================================================================================
  const handleImportCSVInventory = async (csvText) => {
    try {
      const rows = csvText.trim().split("\n");
      const batch = writeBatch(db);
      let count = 0;

      rows.forEach((row) => {
        const cols = row.split(",").map((c) => c.trim());
        if (cols.length >= 3) {
          const ref = doc(collection(db, "inventory"));
          batch.set(ref, {
            name: cols[0],
            unit: cols[1] || "un",
            quantity: Number(cols[2]) || 0,
            minStock: Number(cols[3]) || 5,
            createdAt: serverTimestamp(),
          });

          count++;
        }
      });

      await batch.commit();
      alert(`${count} insumos importados.`);
    } catch (error) {
      alert("Erro ao importar CSV de insumos.");
    }
  };


  // =====================================================================================
  // IMPORTADOR CSV — AGENDA (NOVO) — MODELO C SIMPLES
  // Formato:
  // Nome,Insumo,Dose,Data
  // =====================================================================================
  const handleImportCSVAgenda = async (csvText) => {
    try {
      const rows = csvText.trim().split("\n");
      let count = 0;
      const batch = writeBatch(db);

      for (let row of rows) {
        const [patientName, insumoName, dose, dateStr] = row.split(",").map((c) => c.trim());

        if (!patientName || !insumoName || !dose || !dateStr) continue;

        // Localiza o insumo pelo NOME
        const insumo = inventory.find(
          (i) => i.name.toLowerCase() === insumoName.toLowerCase()
        );

        if (!insumo) {
          console.warn(`INSUMO NÃO ENCONTRADO: ${insumoName}`);
          continue;
        }

        // Data
        const date = Timestamp.fromDate(new Date(dateStr));

        const ref = doc(collection(db, "schedule"));

        batch.set(ref, {
          patientName,
          items: [
            {
              medicationId: insumo.id,
              dose: Number(dose),
            }
          ],
          date,
          status: "scheduled",
          createdAt: serverTimestamp(),
        });

        count++;
      }

      await batch.commit();
      alert(`${count} aplicações importadas para agenda.`);

    } catch (e) {
      alert("Erro ao importar CSV da agenda: " + e.message);
    }
  };


  // =====================================================================================
  // FUNÇÕES — AGENDA
  // =====================================================================================

  // Criar agendamento manual
  const handleSchedulePatient = async (data) => {
    await addDoc(collection(db, "schedule"), {
      ...data,
      status: "scheduled",
      createdAt: serverTimestamp(),
    });
  };

  // Editar agendamento
  const handleEditSchedule = async (id, updated) => {
    await updateDoc(doc(db, "schedule", id), {
      ...updated,
      updatedAt: serverTimestamp(),
    });
  };

  // Aplicar (desconta estoque e marca aplicado)
  const handleApply = async (appointment, appliedDateStr) => {

    const items = appointment.items || [{
      medicationId: appointment.medicationId,
      dose: appointment.dose,
    }];

    // 1. Verifica estoque
    for (const item of items) {
      const stockItem = inventory.find((i) => i.id === item.medicationId);
      if (!stockItem) return alert("Insumo não encontrado.");
      if (stockItem.quantity < item.dose) {
        return alert(`Estoque insuficiente de ${stockItem.name}`);
      }
    }

    // 2. Ajusta data aplicada
    const date = new Date(appliedDateStr);
    const now = new Date();
    date.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    const finalDate = Timestamp.fromDate(date);

    // 3. Batch
    const batch = writeBatch(db);

    items.forEach((item) => {
      const ref = doc(db, "inventory", item.medicationId);
      batch.update(ref, { quantity: increment(-Number(item.dose)) });
    });

    const scheduleRef = doc(db, "schedule", appointment.id);
    batch.update(scheduleRef, {
      status: "applied",
      appliedAt: finalDate,
    });

    await batch.commit();
  };

  // Desfazer aplicação
  const handleUndoApply = async (appointment) => {
    if (!confirm("Desfazer aplicação?")) return;

    const items = appointment.items || [{
      medicationId: appointment.medicationId,
      dose: appointment.dose
    }];

    const batch = writeBatch(db);

    items.forEach((item) => {
      const ref = doc(db, "inventory", item.medicationId);
      batch.update(ref, { quantity: increment(Number(item.dose)) });
    });

    batch.update(doc(db, "schedule", appointment.id), {
      status: "scheduled",
      appliedAt: null,
    });

    await batch.commit();
  };

  // Deletar agendamento
  const handleDeleteSchedule = async (id) => {
    await deleteDoc(doc(db, "schedule", id));
  };


  // =====================================================================================
  // ATÉ AQUI FICA A PARTE 1
  // O PRÓXIMO BLOCO COMEÇA COM O LAYOUT (SIDEBAR + HEADER)
  // =====================================================================================

// =====================================================================================
// PARTE 2 — HEADER, MÉTRICAS E NAVEGAÇÃO
// =====================================================================================

  // ============================
  // CÁLCULOS PARA AS MÉTRICAS
  // ============================

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const appliedToday = schedule.filter(
    (s) => s.status === "applied" && s.appliedAt?.seconds * 1000 >= today.getTime()
  ).length;

  const pendingCount = schedule.filter((s) => s.status === "scheduled").length;

  const criticalStock = inventory.filter((i) =>
    i.quantity <= i.minStock || i.quantity === 0
  ).length;


  // ============================
  // RENDERIZAÇÃO PRINCIPAL
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
      <div className="flex flex-col items-center justify-center h-screen text-red-700 text-center px-6">
        <AlertTriangle size={40} className="mb-4" />
        <h2 className="font-bold text-lg">Erro ao carregar dados</h2>
        <p className="text-sm bg-red-50 border border-red-200 p-3 rounded-lg mt-2">{errorMsg}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 rounded-lg bg-red-600 text-white"
        >
          Tentar novamente
        </button>
      </div>
    );
  }


  // =====================================================================================
  // UI DO APP
  // =====================================================================================

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-20 md:pb-0">

      {/* ========================== HEADER SUPERIOR ========================== */}
      <header className="bg-white shadow-sm border-b border-slate-200 p-4 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-between">

          {/* LOGO */}
          <div className="flex items-center gap-2">
            <div className="bg-teal-600 p-2 rounded-lg shadow">
              <Activity className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              Clinic<span className="text-teal-600">Control</span>
            </h1>
          </div>

          {/* NAV DESKTOP */}
          <nav className="hidden md:flex gap-3">
            <NavButton label="Enfermaria" icon={<Users size={18} />} active={activeTab === "agenda"} onClick={() => setActiveTab("agenda")} />
            <NavButton label="Estoque" icon={<Package size={18} />} active={activeTab === "estoque"} onClick={() => setActiveTab("estoque")} />
            <NavButton label="Planejamento" icon={<BarChart3 size={18} />} active={activeTab === "compras"} onClick={() => setActiveTab("compras")} />
            <NavButton label="Pacientes" icon={<FileText size={18} />} active={activeTab === "pacientes"} onClick={() => setActiveTab("pacientes")} />
          </nav>

        </div>
      </header>


      {/* ========================== BLOCOS DE MÉTRICAS ========================== */}
      <section className="max-w-6xl mx-auto px-4 mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* FILA DE APLICAÇÃO */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-amber-100 text-amber-700 p-3 rounded-full">
            <Clock size={26} />
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-amber-700">Fila de Aplicação</p>
            <h2 className="text-3xl font-black text-amber-800">{pendingCount}</h2>
          </div>
        </div>

        {/* APLICADOS HOJE */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-teal-100 text-teal-700 p-3 rounded-full">
            <CheckCircle size={26} />
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-teal-700">Aplicados Hoje</p>
            <h2 className="text-3xl font-black text-teal-800">{appliedToday}</h2>
          </div>
        </div>

        {/* INSUMOS CRÍTICOS */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-red-100 text-red-700 p-3 rounded-full">
            <AlertTriangle size={26} />
          </div>
          <div>
            <p className="text-xs uppercase font-semibold text-red-700">Insumos Críticos</p>
            <h2 className="text-3xl font-black text-red-800">{criticalStock}</h2>
          </div>
        </div>

      </section>


      {/* ========================== ÁREA DE CONTEÚDO ========================== */}
      <main className="max-w-6xl mx-auto p-4 md:p-6 mt-4">

        {activeTab === "agenda" && (
          <ScheduleTab
            inventory={inventory}
            schedule={schedule}
            onSchedule={handleSchedulePatient}
            onEdit={handleEditSchedule}
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
          <PatientsTab schedule={schedule} inventory={inventory} />
        )}

      </main>


      {/* ========================== NAV MOBILE ========================== */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-2 flex justify-around shadow-lg z-50">
        <MobileNav label="Agenda" icon={<Users size={20} />} active={activeTab === "agenda"} onClick={() => setActiveTab("agenda")} />
        <MobileNav label="Estoque" icon={<Package size={20} />} active={activeTab === "estoque"} onClick={() => setActiveTab("estoque")} />
        <MobileNav label="Planejamento" icon={<BarChart3 size={20} />} active={activeTab === "compras"} onClick={() => setActiveTab("compras")} />
        <MobileNav label="Pacientes" icon={<FileText size={20} />} active={activeTab === "pacientes"} onClick={() => setActiveTab("pacientes")} />
      </div>

    </div>
  );
}


// =====================================================================================
// COMPONENTES DE BOTÕES
// =====================================================================================

function NavButton({ label, icon, active, onClick }) {
  return (
    <button
      className={`px-4 py-2 rounded-lg flex items-center gap-2 font-medium text-sm transition-all ${
        active
          ? "bg-teal-50 text-teal-700 border border-teal-200"
          : "text-slate-500 hover:bg-slate-100"
      }`}
      onClick={onClick}
    >
      {icon} {label}
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
// ============================================================================
// PARTE 3 — ABA DE ESTOQUE + IMPORTAÇÃO DE INSUMOS + IMPORTAÇÃO DE AGENDA
// ============================================================================

function InventoryTab({ inventory, stockLogs, onAdd, onImport, onImportAgenda, onDelete, onUpdateStock }) {

  const [searchTerm, setSearchTerm] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isImportingInventory, setIsImportingInventory] = useState(false);
  const [isImportingAgenda, setIsImportingAgenda] = useState(false);

  const [newItem, setNewItem] = useState({
    name: "",
    unit: "ml",
    quantity: "",
    minStock: ""
  });

  const [deleteItem, setDeleteItem] = useState(null);
  const [stockEntryItem, setStockEntryItem] = useState(null);
  const [stockEntryValue, setStockEntryValue] = useState("");
  const [historyItem, setHistoryItem] = useState(null);


  // FILTRO
  const filteredInventory = inventory.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );


  // ============================================================
  // HANDLERS IMPORTAÇÃO
  // ============================================================

  const handleFileInventory = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      onImport(evt.target.result);
      setIsImportingInventory(false);
    };
    reader.readAsText(file);
  };

  const handleFileAgenda = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      onImportAgenda(evt.target.result);
      setIsImportingAgenda(false);
    };
    reader.readAsText(file);
  };


  // ============================================================
  // HANDLER ADD ITEM
  // ============================================================

  const handleSubmitNewItem = (e) => {
    e.preventDefault();
    onAdd({
      name: newItem.name,
      unit: newItem.unit,
      quantity: Number(newItem.quantity),
      minStock: Number(newItem.minStock) || 5
    });

    setNewItem({ name: "", unit: "ml", quantity: "", minStock: "" });
    setIsAdding(false);
  };


  // ============================================================
  // HANDLERS ESTOQUE
  // ============================================================

  const confirmStockEntry = () => {
    if (!stockEntryItem || !stockEntryValue) return;

    onUpdateStock(stockEntryItem.id, stockEntryValue, stockEntryItem.name);
    setStockEntryItem(null);
    setStockEntryValue("");
  };

  const confirmDelete = () => {
    if (!deleteItem) return;
    onDelete(deleteItem.id);
    setDeleteItem(null);
  };


  // ============================================================
  // JSX
  // ============================================================

  return (
    <div className="space-y-6">

      {/* TÍTULO */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-700 flex items-center gap-2">
            <Package className="text-teal-600" /> Estoque da Clínica
          </h2>
          <p className="text-slate-500 text-sm">Gerencie insumos, entradas e importações.</p>
        </div>

        {/* AÇÕES */}
        <div className="flex flex-wrap gap-2">

          {/* BUSCA */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar insumo..."
              className="pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm w-48"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* IMPORTAR INSUMOS */}
          <button
            onClick={() => setIsImportingInventory(true)}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg flex items-center gap-2"
          >
            <Upload size={18} /> Importar Insumos
          </button>

          {/* IMPORTAR AGENDAMENTOS */}
          <button
            onClick={() => setIsImportingAgenda(true)}
            className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg flex items-center gap-2"
          >
            <Upload size={18} /> Importar Agenda
          </button>

          {/* NOVO ITEM */}
          <button
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-md"
            onClick={() => setIsAdding(true)}
          >
            <Plus size={18} /> Novo Insumo
          </button>
        </div>
      </div>


      {/* ========================= IMPORTAÇÃO DE INSUMOS ========================== */}
      {isImportingInventory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">

            <h3 className="font-bold text-lg text-slate-700 mb-2">
              Importar Insumos (.csv)
            </h3>

            <p className="text-sm text-slate-500 mb-4">
              Formato esperado: <br/>
              Nome, Unidade, Quantidade Inicial, Mínimo
            </p>

            <label className="cursor-pointer block border-2 border-dashed border-slate-300 p-8 rounded-lg text-center bg-slate-50 hover:bg-slate-100">
              <Upload size={30} className="text-slate-400 mx-auto mb-2" />
              <span className="text-sm font-medium">Clique para selecionar o arquivo</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleFileInventory} />
            </label>

            <button
              className="mt-4 w-full py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
              onClick={() => setIsImportingInventory(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}


      {/* ========================= IMPORTAÇÃO DE AGENDA ========================== */}
      {isImportingAgenda && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">

            <h3 className="font-bold text-lg text-slate-700 mb-2">
              Importar Agendamentos (.csv)
            </h3>

            <p className="text-sm text-slate-500 mb-4">
              Formato esperado: <br/>
              NomePaciente, Insumo, Dose, Data  
              <br />
              Exemplo: <strong>Maria,Laennec,2,2025-12-10</strong>
            </p>

            <label className="cursor-pointer block border-2 border-dashed border-slate-300 p-8 rounded-lg text-center bg-slate-50 hover:bg-slate-100">
              <Upload size={30} className="text-blue-500 mx-auto mb-2" />
              <span className="text-sm font-medium text-blue-700">Selecione o arquivo .csv</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleFileAgenda} />
            </label>

            <button
              className="mt-4 w-full py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
              onClick={() => setIsImportingAgenda(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}



      {/* ========================= FORM DE NOVO ITEM ========================== */}
      {isAdding && (
        <form
          onSubmit={handleSubmitNewItem}
          className="bg-white border border-slate-200 shadow-md p-6 rounded-xl animate-fadeIn"
        >
          <h3 className="font-semibold text-slate-700 mb-4">Cadastrar Novo Insumo</h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

            <div className="md:col-span-2">
              <label className="text-xs text-slate-500">Nome</label>
              <input
                required
                type="text"
                className="input"
                value={newItem.name}
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Unidade</label>
              <select
                className="input"
                value={newItem.unit}
                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
              >
                <option value="ml">ml</option>
                <option value="mg">mg</option>
                <option value="un">un</option>
                <option value="amp">amp</option>
                <option value="fr">fr</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-500">Estoque Inicial</label>
              <input
                required
                type="number"
                className="input"
                value={newItem.quantity}
                onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Estoque Mínimo</label>
              <input
                type="number"
                className="input"
                value={newItem.minStock}
                onChange={(e) => setNewItem({ ...newItem, minStock: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white shadow"
            >
              Salvar
            </button>
          </div>
        </form>
      )}


      {/* ========================= CARDS DE INSUMOS ========================== */}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        {filteredInventory.map((item) => (
          <div
            key={item.id}
            className="bg-white p-5 border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-all relative"
          >
            <div className={`absolute left-0 top-0 w-1 h-full ${
              item.quantity <= item.minStock ? "bg-red-500" : "bg-teal-500"
            }`} />

            <div className="flex justify-between">
              <h3 className="font-bold text-lg text-slate-700">{item.name}</h3>

              <div className="flex gap-2">
                <button
                  className="icon-btn text-slate-400 hover:text-teal-600"
                  onClick={() => setHistoryItem(item)}
                >
                  <History size={18} />
                </button>

                <button
                  className="icon-btn text-slate-400 hover:text-red-600"
                  onClick={() => setDeleteItem(item)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>

            <div className="mt-2 flex items-baseline gap-1">
              <span className={`text-3xl font-black ${
                item.quantity <= item.minStock ? "text-red-600" : "text-slate-800"
              }`}>
                {item.quantity}
              </span>
              <span className="text-sm text-slate-500">{item.unit}</span>
            </div>

            <p className="text-xs text-slate-500 mt-1">
              Mínimo: <strong>{item.minStock}</strong>
            </p>

            <button
              className="mt-4 w-full bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-600 py-2 rounded-lg text-sm flex justify-center items-center gap-2 border border-slate-200"
              onClick={() => setStockEntryItem(item)}
            >
              <Plus size={14} /> Entrada de Estoque
            </button>
          </div>
        ))}
      </div>

      {inventory.length === 0 && (
        <p className="text-center text-slate-400 py-10 text-sm">
          Nenhum insumo cadastrado ainda.
        </p>
      )}


      {/* ========================= POPUP DE ENTRADA DE ESTOQUE ========================== */}
      {stockEntryItem && (
        <div className="popup">
          <div className="popup-card max-w-sm">
            <h3 className="popup-title">Entrada de Estoque</h3>

            <p className="text-sm mb-4">
              Adicionando para: <strong>{stockEntryItem.name}</strong>
            </p>

            <input
              type="number"
              autoFocus
              placeholder="Quantidade"
              className="input mb-4"
              value={stockEntryValue}
              onChange={(e) => setStockEntryValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmStockEntry()}
            />

            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => setStockEntryItem(null)}
              >
                Cancelar
              </button>

              <button
                className="btn-primary flex-1"
                onClick={confirmStockEntry}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ========================= POPUP DE EXCLUSÃO ========================== */}
      {deleteItem && (
        <div className="popup">
          <div className="popup-card max-w-sm text-center">
            <Trash2 size={36} className="text-red-600 mx-auto mb-3" />

            <h3 className="popup-title">Excluir Insumo?</h3>
            <p>Confirma apagar <strong>{deleteItem.name}</strong>?</p>

            <div className="flex gap-3 mt-6">
              <button className="btn-secondary flex-1" onClick={() => setDeleteItem(null)}>
                Cancelar
              </button>

              <button className="btn-danger flex-1" onClick={confirmDelete}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ========================= HISTÓRICO DE ENTRADAS ========================== */}
      {historyItem && (
        <div className="popup">
          <div className="popup-card max-w-md max-h-[80vh] overflow-y-auto">

            <div className="flex justify-between items-center mb-4">
              <h3 className="popup-title flex items-center gap-2">
                <History size={20} className="text-teal-600" />
                Histórico de Entradas
              </h3>

              <button className="icon-btn text-slate-400" onClick={() => setHistoryItem(null)}>
                <X size={18} />
              </button>
            </div>

            <p className="font-bold mb-4">{historyItem.name}</p>

            {stockLogs.filter((log) => log.itemId === historyItem.id).length === 0 && (
              <p className="text-center text-slate-400 py-6">Nenhum registro.</p>
            )}

            {stockLogs
              .filter((log) => log.itemId === historyItem.id)
              .sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds)
              .map((log) => (
                <div
                  key={log.id}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2"
                >
                  <p className="font-medium">
                    +{log.quantity} {historyItem.unit}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock size={10} />{" "}
                    {log.createdAt
                      ? new Date(log.createdAt.seconds * 1000).toLocaleString("pt-BR")
                      : "Data desconhecida"}
                  </p>
                </div>
              ))}

            <button
              className="btn-secondary w-full mt-4"
              onClick={() => setHistoryItem(null)}
            >
              Fechar
            </button>

          </div>
        </div>
      )}

    </div>
  );
}
// ============================================================================
// PARTE 4 — ENFERMARIA (AGENDA), PACIENTES E DASHBOARD
// ============================================================================


// ---------------------------------------------------------------------------
// HELPERS DE DATA
// ---------------------------------------------------------------------------
function getScheduleDate(scheduleItem) {
  // Se for Timestamp (vindo do Firestore)
  if (scheduleItem?.date?.seconds) {
    return new Date(scheduleItem.date.seconds * 1000);
  }
  // Se for string "YYYY-MM-DD"
  if (typeof scheduleItem.date === "string") {
    return new Date(scheduleItem.date + "T00:00:00");
  }
  return null;
}


// ---------------------------------------------------------------------------
// SCHEDULE TAB — ENFERMARIA
// ---------------------------------------------------------------------------
function ScheduleTab({ inventory, schedule, onSchedule, onEdit, onApply, onUndo, onDelete }) {

  const [patientName, setPatientName] = useState("");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [sessions, setSessions] = useState(1);
  const [items, setItems] = useState([
    { id: Date.now(), medicationId: "", dose: "" }
  ]);

  const [selectedForApply, setSelectedForApply] = useState(null);
  const [applyDate, setApplyDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  // Pendentes e aplicados
  const pending = schedule.filter((s) => s.status !== "applied");
  const applied = schedule
    .filter((s) => s.status === "applied")
    .sort((a, b) => {
      const da = a.appliedAt?.seconds || 0;
      const db = b.appliedAt?.seconds || 0;
      return db - da;
    });

  // ---------------------------
  // Formulário de novo agendamento
  // ---------------------------
  const addItemLine = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), medicationId: "", dose: "" }
    ]);
  };

  const removeItemLine = (id) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const updateItemField = (id, field, value) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!patientName.trim()) {
      alert("Informe o nome do paciente.");
      return;
    }

    const cleanItems = items.filter(
      (i) => i.medicationId && i.dose && Number(i.dose) > 0
    );
    if (cleanItems.length === 0) {
      alert("Adicione pelo menos um insumo e dose.");
      return;
    }

    const base = new Date(startDate + "T00:00:00");

    // Repetir semanalmente conforme sessions
    const totalSessions = Math.max(1, Number(sessions) || 1);

    for (let idx = 0; idx < totalSessions; idx++) {
      const d = new Date(base);
      d.setDate(base.getDate() + idx * 7);

      const dateTimestamp = Timestamp.fromDate(d);

      await onSchedule({
        patientName,
        items: cleanItems.map(({ id, ...rest }) => rest),
        date: dateTimestamp,
        sessionIndex: idx + 1,
        sessions: totalSessions
      });
    }

    setPatientName("");
    setStartDate(new Date().toISOString().split("T")[0]);
    setSessions(1);
    setItems([{ id: Date.now(), medicationId: "", dose: "" }]);
  };

  // ---------------------------
  // Aplicar com data personalizada
  // ---------------------------
  const openApplyModal = (item) => {
    setSelectedForApply(item);
    setApplyDate(new Date().toISOString().split("T")[0]);
  };

  const confirmApply = async () => {
    if (!selectedForApply) return;
    await onApply(selectedForApply, applyDate);
    setSelectedForApply(null);
  };


  // ---------------------------
  // RENDER
  // ---------------------------
  return (
    <div className="space-y-6">

      {/* FORM CADASTRO PROTOCOLO */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-700 mb-4 flex items-center gap-2">
          <Users className="text-teal-600" size={18} />
          Agendar Protocolo
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">

          <div>
            <label className="text-xs text-slate-500">Paciente</label>
            <input
              type="text"
              required
              className="input w-full"
              placeholder="Nome completo do paciente"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-slate-600 mb-2">
              Insumos do protocolo
            </p>

            {items.map((it, idx) => (
              <div key={it.id} className="flex gap-2 mb-2 items-center">
                <select
                  required
                  className="input flex-1"
                  value={it.medicationId}
                  onChange={(e) =>
                    updateItemField(it.id, "medicationId", e.target.value)
                  }
                >
                  <option value="">Selecione o insumo...</option>
                  {inventory.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name} ({inv.unit})
                    </option>
                  ))}
                </select>

                <input
                  required
                  type="number"
                  step="0.1"
                  className="input w-24"
                  placeholder="Dose"
                  value={it.dose}
                  onChange={(e) =>
                    updateItemField(it.id, "dose", e.target.value)
                  }
                />

                {items.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn text-red-500"
                    onClick={() => removeItemLine(it.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={addItemLine}
              className="text-xs text-teal-600 mt-2 flex items-center gap-1"
            >
              <Plus size={12} /> Adicionar insumo
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-slate-500">Data Inicial</label>
              <input
                type="date"
                required
                className="input w-full"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">Repetições (semanas)</label>
              <input
                type="number"
                min={1}
                className="input w-full"
                value={sessions}
                onChange={(e) => setSessions(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Agendar
          </button>
        </form>
      </div>


      {/* LISTAS: PENDENTES E APLICADOS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* PENDENTES */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              Fila de Aplicação
            </h3>
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              {pending.length}
            </span>
          </div>

          <div className="space-y-3">
            {pending.length === 0 && (
              <p className="text-slate-400 text-sm bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center">
                Nenhum paciente pendente.
              </p>
            )}

            {pending.map((item) => {
              const date = getScheduleDate(item);
              const meds = (item.items || []).map((it) => {
                const inv = inventory.find((inv) => inv.id === it.medicationId);
                return {
                  ...it,
                  name: inv?.name || "Insumo removido",
                  unit: inv?.unit || ""
                };
              });

              return (
                <div
                  key={item.id}
                  className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold text-slate-700">
                      {item.patientName}
                      {item.sessions > 1 && (
                        <span className="ml-2 text-xs bg-slate-100 px-2 py-0.5 rounded-full text-slate-500">
                          Sessão {item.sessionIndex}/{item.sessions}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      Agendado:{" "}
                      {date ? date.toLocaleDateString("pt-BR") : "Sem data"}
                    </p>

                    <ul className="mt-2 text-xs text-slate-600 space-y-1">
                      {meds.map((m, idx) => (
                        <li key={idx}>
                          • {m.name} —{" "}
                          <strong>
                            {m.dose} {m.unit}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col gap-2 items-end justify-between">
                    <button
                      className="btn-primary text-xs px-3 py-1.5"
                      onClick={() => openApplyModal(item)}
                    >
                      Aplicar
                    </button>

                    <button
                      className="text-xs text-red-500"
                      onClick={() => onDelete(item.id)}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* HISTÓRICO APLICADOS */}
        <div>
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
            Últimas Aplicações
          </h3>

          <div className="bg-white border border-slate-200 rounded-xl p-3 max-h-[420px] overflow-y-auto">
            {applied.length === 0 && (
              <p className="text-slate-400 text-sm py-6 text-center">
                Ainda não há aplicações registradas.
              </p>
            )}

            {applied.map((item) => {
              const dateApplied = item.appliedAt?.seconds
                ? new Date(item.appliedAt.seconds * 1000)
                : null;

              const meds = (item.items || []).map((it) => {
                const inv = inventory.find((inv) => inv.id === it.medicationId);
                return {
                  ...it,
                  name: inv?.name || "Insumo removido",
                  unit: inv?.unit || ""
                };
              });

              return (
                <div
                  key={item.id}
                  className="flex justify-between items-center border-b border-slate-100 py-2 last:border-b-0"
                >
                  <div>
                    <p className="font-medium text-slate-700 text-sm">
                      {item.patientName}
                    </p>

                    <ul className="text-xs text-slate-600 space-y-1 mt-1">
                      {meds.map((m, idx) => (
                        <li key={idx}>
                          • {m.name} —{" "}
                          <strong>
                            {m.dose} {m.unit}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-slate-500">
                      {dateApplied
                        ? dateApplied.toLocaleDateString("pt-BR")
                        : "Hoje"}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {dateApplied
                        ? dateApplied.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit"
                          })
                        : ""}
                    </p>

                    <button
                      className="text-[10px] text-amber-600 mt-1"
                      onClick={() => onUndo(item)}
                    >
                      Desfazer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>


      {/* MODAL APLICAR */}
      {selectedForApply && (
        <div className="popup">
          <div className="popup-card max-w-sm">
            <h3 className="popup-title mb-2">Confirmar Aplicação</h3>
            <p className="text-sm mb-3">
              Paciente: <strong>{selectedForApply.patientName}</strong>
            </p>

            <label className="text-xs text-slate-500">Data real</label>
            <input
              type="date"
              className="input w-full mb-4"
              value={applyDate}
              onChange={(e) => setApplyDate(e.target.value)}
            />

            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                onClick={() => setSelectedForApply(null)}
              >
                Cancelar
              </button>
              <button
                className="btn-primary flex-1"
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



// ---------------------------------------------------------------------------
// PATIENTS TAB — NOVO PAINEL POR PACIENTE
// ---------------------------------------------------------------------------
function PatientsTab({ schedule, inventory }) {

  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(null);

  // Lista única de nomes de pacientes
  const patients = Array.from(
    new Set(schedule.map((s) => (s.patientName || "").trim()).filter(Boolean))
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* COLUNA DE PACIENTES */}
      <div className="lg:col-span-1 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
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
            className="input w-full pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="max-h-[380px] overflow-y-auto space-y-1">
          {filteredPatients.length === 0 && (
            <p className="text-xs text-slate-400 py-4 text-center">
              Nenhum paciente encontrado.
            </p>
          )}

          {filteredPatients.map((p) => (
            <button
              key={p}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                selectedPatient === p
                  ? "bg-teal-50 text-teal-700 font-semibold"
                  : "hover:bg-slate-100 text-slate-600"
              }`}
              onClick={() => setSelectedPatient(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>


      {/* COLUNA DE HISTÓRICO DO PACIENTE */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        {!selectedPatient && (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            Selecione um paciente ao lado para ver o histórico.
          </div>
        )}

        {selectedPatient && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-700 text-base">
                Histórico de aplicações — <span className="text-teal-700">{selectedPatient}</span>
              </h2>
              <span className="text-xs text-slate-400">
                Total de registros: {recordsForSelected.length}
              </span>
            </div>

            {recordsForSelected.length === 0 && (
              <p className="text-xs text-slate-400 py-4">
                Nenhum registro encontrado para este paciente.
              </p>
            )}

            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {recordsForSelected.map((rec) => {
                const date = getScheduleDate(rec);
                const appliedDate = rec.appliedAt?.seconds
                  ? new Date(rec.appliedAt.seconds * 1000)
                  : null;

                const meds = (rec.items || []).map((it) => {
                  const inv = inventory.find((i) => i.id === it.medicationId);
                  return {
                    ...it,
                    name: inv?.name || "Insumo removido",
                    unit: inv?.unit || ""
                  };
                });

                const status =
                  rec.status === "applied"
                    ? "Aplicado"
                    : rec.status === "scheduled"
                    ? "Pendente"
                    : rec.status || "Pendente";

                return (
                  <div key={rec.id} className="py-3 flex justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500">
                        Agendado:{" "}
                        {date ? date.toLocaleDateString("pt-BR") : "Sem data"}
                      </p>
                      {appliedDate && (
                        <p className="text-[11px] text-slate-400">
                          Aplicado em:{" "}
                          {appliedDate.toLocaleDateString("pt-BR")}{" "}
                          {appliedDate.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                      )}

                      <ul className="mt-2 text-xs text-slate-600 space-y-1">
                        {meds.map((m, idx) => (
                          <li key={idx}>
                            • {m.name} —{" "}
                            <strong>
                              {m.dose} {m.unit}
                            </strong>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="text-right flex flex-col items-end justify-between">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full ${
                          status === "Aplicado"
                            ? "bg-teal-50 text-teal-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}



// ---------------------------------------------------------------------------
// DASHBOARD TAB — PREVISÃO SIMPLES
// ---------------------------------------------------------------------------
function DashboardTab({ inventory, schedule }) {

  // Mapa por insumo
  const analysis = inventory.map((item) => {
    const future = schedule.filter((s) => s.status !== "applied");

    let scheduledUsage = 0;
    future.forEach((s) => {
      (s.items || []).forEach((it) => {
        if (it.medicationId === item.id) {
          scheduledUsage += Number(it.dose) || 0;
        }
      });
    });

    const finalStock = item.quantity - scheduledUsage;
    const status =
      finalStock < 0
        ? "critical"
        : finalStock < (item.minStock || 5)
        ? "warning"
        : "ok";

    return {
      name: item.name,
      unit: item.unit,
      currentStock: item.quantity,
      minStock: item.minStock || 5,
      scheduledUsage,
      finalStock,
      status
    };
  });


  const critical = analysis.filter((a) => a.status === "critical");
  const warning = analysis.filter((a) => a.status === "warning");


  return (
    <div className="space-y-6">

      {/* CARDS RESUMO */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-xs uppercase text-red-700 font-semibold mb-1">
            Ruptura de estoque
          </p>
          <p className="text-3xl font-black text-red-800">{critical.length}</p>
          <p className="text-xs text-red-700 mt-1">
            Itens que podem zerar com a agenda atual.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-xs uppercase text-amber-700 font-semibold mb-1">
            Abaixo do mínimo
          </p>
          <p className="text-3xl font-black text-amber-800">{warning.length}</p>
          <p className="text-xs text-amber-700 mt-1">
            Insumos que exigem atenção na próxima compra.
          </p>
        </div>

        <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
          <p className="text-xs uppercase text-teal-700 font-semibold mb-1">
            Insumos cadastrados
          </p>
          <p className="text-3xl font-black text-teal-800">{inventory.length}</p>
          <p className="text-xs text-teal-700 mt-1">
            Total de insumos ativos no sistema.
          </p>
        </div>
      </div>


      {/* TABELA DETALHADA */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Insumo</th>
              <th className="text-center px-4 py-2 font-semibold">Atual</th>
              <th className="text-center px-4 py-2 font-semibold">Uso Previsto</th>
              <th className="text-center px-4 py-2 font-semibold">Saldo Estimado</th>
              <th className="text-center px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {analysis.map((a) => (
              <tr key={a.name} className="border-b last:border-b-0 border-slate-100">
                <td className="px-4 py-2">{a.name}</td>
                <td className="px-4 py-2 text-center">
                  {a.currentStock}{" "}
                  <span className="text-xs text-slate-400">{a.unit}</span>
                </td>
                <td className="px-4 py-2 text-center">
                  {a.scheduledUsage > 0 ? (
                    <>
                      -{a.scheduledUsage}{" "}
                      <span className="text-xs text-slate-400">{a.unit}</span>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-2 text-center">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      a.finalStock < 0
                        ? "bg-red-100 text-red-700"
                        : a.finalStock < a.minStock
                        ? "bg-amber-100 text-amber-700"
                        : "bg-teal-100 text-teal-700"
                    }`}
                  >
                    {a.finalStock} {a.unit}
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
                  {a.status === "critical" && (
                    <span className="text-xs text-red-700 font-semibold">
                      Crítico
                    </span>
                  )}
                  {a.status === "warning" && (
                    <span className="text-xs text-amber-700 font-semibold">
                      Atenção
                    </span>
                  )}
                  {a.status === "ok" && (
                    <span className="text-xs text-teal-700 font-semibold">
                      OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

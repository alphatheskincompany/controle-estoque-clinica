import React, { useState, useEffect } from 'react';
import {
  Trash2, Plus, Syringe, Users, BarChart3,
  AlertTriangle, CheckCircle, Package, ArrowRight,
  Search, Upload, X, History, Clock, Edit2,
  Calendar, CalendarClock
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from 'firebase/auth';

import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, serverTimestamp, increment,
  Timestamp, writeBatch, getDocs
} from 'firebase/firestore';


// ===============================
// 🔥 CONFIG FIREBASE — EDITE SE PRECISAR
// ===============================
const firebaseConfig = {
  apiKey: "AIzaSyA3we_zXf-NS_WKDE8rOLEVvpWAzsBfkQU",
  authDomain: "clinicaestoquethc.firebaseapp.com",
  projectId: "clinicaestoquethc",
  storageBucket: "clinicaestoquethc.firebasestorage.app",
  messagingSenderId: "700610674954",
  appId: "1:700610674954:web:8f22262a7350808a787af3"
};

// Init Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// ==================================
// 🔥 COMPONENTE PRINCIPAL DO SISTEMA
// ==================================
export default function ClinicStockApp() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("agenda");

  const [inventory, setInventory] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [stockLogs, setStockLogs] = useState([]);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);


  // ==========================
  // AUTENTICAÇÃO
  // ==========================
  useEffect(() => {
    signInAnonymously(auth).catch((err) => {
      setErrorMsg("Erro ao autenticar: " + err.message);
      setLoading(false);
    });

    const unsub = onAuthStateChanged(auth, (usr) => {
      setUser(usr);
    });

    return () => unsub();
  }, []);


  // ==========================
  // CARREGAR DADOS EM TEMPO REAL
  // ==========================
  useEffect(() => {
    if (!user) return;

    const handleError = (err, label) => {
      setErrorMsg(`Erro ao carregar ${label}: ${err.message}`);
      setLoading(false);
    };

    const unsubInventory = onSnapshot(
      collection(db, "inventory"),
      snap => {
        setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      err => handleError(err, "estoque")
    );

    const unsubSchedule = onSnapshot(
      collection(db, "schedule"),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setSchedule(data);
        setLoading(false);
      },
      err => handleError(err, "agenda")
    );

    const unsubLogs = onSnapshot(
      collection(db, "stock_logs"),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setStockLogs(
          data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        );
      }
    );

    return () => {
      unsubInventory();
      unsubSchedule();
      unsubLogs();
    };
  }, [user]);



  // =================================
  // AÇÕES GERAIS DO SISTEMA
  // =================================

  // Criar item estoque
  const handleAddInventory = async (item) => {
    await addDoc(collection(db, "inventory"), {
      ...item,
      createdAt: serverTimestamp()
    });
  };

  // Importação CSV estoque
  const handleImportCSV = async (csvText) => {
    const rows = csvText.split("\n");
    const batch = writeBatch(db);

    rows.forEach(line => {
      const cols = line.split(",").map(c => c.trim());
      if (!cols[0]) return;

      batch.set(doc(collection(db, "inventory")), {
        name: cols[0],
        unit: cols[1] || "un",
        quantity: Number(cols[2] || 0),
        minStock: Number(cols[3] || 0),
        createdAt: serverTimestamp()
      });
    });

    await batch.commit();
  };

  // IMPORTAÇÃO DE AGENDA (pacientes)
  const handleImportPatientsCSV = async (csvText) => {
    const rows = csvText.split("\n");
    const batch = writeBatch(db);

    rows.forEach(line => {
      const cols = line.split(",").map(c => c.trim());
      if (cols.length < 4) return;

      const [patient, medName, dose, dateStr] = cols;

      if (!patient || !medName || !dose || !dateStr) return;

      batch.set(doc(collection(db, "schedule")), {
        patientName: patient,
        items: [
          { medicationName: medName, dose: Number(dose.replace(",", ".")) }
        ],
        status: "scheduled",
        date: Timestamp.fromDate(new Date(dateStr + "T00:00:00")),
        createdAt: serverTimestamp()
      });
    });

    await batch.commit();
  };


  // Atualizar quantidade
  const handleUpdateStock = async (id, qnt) => {
    await updateDoc(doc(db, "inventory", id), {
      quantity: increment(Number(qnt))
    });
  };

  // Editar insumo
  const handleEditInventory = async (id, item) => {
    await updateDoc(doc(db, "inventory", id), item);
  };

  // Apagar 1 item
  const handleDeleteInventory = async (id) => {
    await deleteDoc(doc(db, "inventory", id));
  };

  // 🔥 LIMPAR TODO O ESTOQUE
  const handleClearAllInventory = async () => {
    const snap = await getDocs(collection(db, "inventory"));
    const batch = writeBatch(db);

    snap.forEach(docRef => batch.delete(docRef.ref));

    await batch.commit();
  };


  // Criar agendamento
  const handleSchedulePatient = async (data) => {
    await addDoc(collection(db, "schedule"), {
      ...data,
      createdAt: serverTimestamp()
    });
  };

  // Aplicar protocolo
  const handleApply = async (appointment, dateString) => {
    const d = Timestamp.fromDate(new Date(dateString + "T00:00:00"));

    const batch = writeBatch(db);

    // desconta do estoque
    appointment.items.forEach(it => {
      const inv = inventory.find(i => i.id === it.medicationId);
      if (inv) {
        batch.update(doc(db, "inventory", inv.id), {
          quantity: increment(-Number(it.dose))
        });
      }
    });

    // muda status
    batch.update(doc(db, "schedule", appointment.id), {
      status: "applied",
      appliedAt: d
    });

    await batch.commit();
  };

  // Desfazer aplicação
  const handleUndo = async (appointment) => {
    const batch = writeBatch(db);

    appointment.items.forEach(it => {
      batch.update(doc(db, "inventory", it.medicationId), {
        quantity: increment(Number(it.dose))
      });
    });

    batch.update(doc(db, "schedule", appointment.id), {
      status: "scheduled",
      appliedAt: null
    });

    await batch.commit();
  };

  // Apagar agendamento
  const handleDeleteSchedule = async (id) => {
    await deleteDoc(doc(db, "schedule", id));
  };


  // ===============================
  // CARREGANDO OU ERRO
  // ===============================
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-500 text-lg">
        Carregando...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <p className="text-red-500 text-xl mb-3">{errorMsg}</p>
        <button onClick={() => window.location.reload()} className="px-4 py-2 bg-red-600 text-white rounded-lg">
          Recarregar
        </button>
      </div>
    );
  }


  // ===============================
  // RENDER
  // ===============================
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 p-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-700 flex items-center gap-2">
            <Package className="text-teal-600" />
            Clinic<span className="text-teal-600">Control</span>
          </h1>

          <nav className="hidden md:flex gap-2">
            <NavButton active={activeTab === "agenda"}  onClick={() => setActiveTab("agenda")}  label="Enfermaria" icon={<Users size={18} />} />
            <NavButton active={activeTab === "estoque"} onClick={() => setActiveTab("estoque")} label="Estoque" icon={<Package size={18} />} />
            <NavButton active={activeTab === "pacientes"} onClick={() => setActiveTab("pacientes")} label="Pacientes" icon={<Users size={18} />} />
            <NavButton active={activeTab === "compras"} onClick={() => setActiveTab("compras")} label="Planejamento" icon={<BarChart3 size={18} />} />
          </nav>
        </div>
      </header>

      {/* CONTEÚDO */}
      <main className="max-w-5xl mx-auto p-4">
        {activeTab === "estoque" && (
          <InventoryTab
            inventory={inventory}
            stockLogs={stockLogs}
            onAdd={handleAddInventory}
            onImport={handleImportCSV}
            onClear={handleClearAllInventory}
            onDelete={handleDeleteInventory}
            onUpdate={handleEditInventory}
            onUpdateStock={handleUpdateStock}
          />
        )}

        {activeTab === "agenda" && (
  <ScheduleTab
    inventory={inventory}
    schedule={schedule}
    onSchedule={handleSchedulePatient}
    onApply={handleApply}
    onUndo={handleUndo}
    onDelete={handleDeleteSchedule}
    onImportAgenda={handleImportPatientsCSV}  // ⬅ ADICIONE ISSO
  />
)}


        {activeTab === "pacientes" && (
          <PatientsTab
            schedule={schedule}
            inventory={inventory}
            onApply={handleApply}
            onUndo={handleUndo}
          />
        )}

        {activeTab === "compras" && (
          <DashboardTab
            inventory={inventory}
            schedule={schedule}
          />
        )}
      </main>
    </div>
  );
}



// ===============================
// BOTÕES DE NAVEGAÇÃO
// ===============================
function NavButton({ active, onClick, label, icon }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
        active ? "bg-teal-50 text-teal-700 border border-teal-200" : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
// ===============================
// PARTE 2 - ESTOQUE (InventoryTab)
// ===============================
function InventoryTab({
  inventory,
  stockLogs,
  onAdd,
  onImport,
  onClear,
  onDelete,
  onUpdate,
  onUpdateStock
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const [newItem, setNewItem] = useState({
    name: "",
    unit: "ml",
    quantity: "",
    minStock: ""
  });

  const [searchTerm, setSearchTerm] = useState("");

  const [entryItem, setEntryItem] = useState(null);
  const [entryQty, setEntryQty] = useState("");

  const [deleteItem, setDeleteItem] = useState(null);
  const [historyItem, setHistoryItem] = useState(null);

  const [editItem, setEditItem] = useState(null);


  // ---------- SUBMIT NOVO ITEM ----------
  const handleSubmitNew = (e) => {
    e.preventDefault();
    if (!newItem.name.trim()) return;

    onAdd({
      name: newItem.name.trim(),
      unit: newItem.unit,
      quantity: Number(newItem.quantity || 0),
      minStock: Number(newItem.minStock || 0)
    });

    setNewItem({
      name: "",
      unit: "ml",
      quantity: "",
      minStock: ""
    });
    setIsAdding(false);
  };


  // ---------- IMPORTAR CSV ----------
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === "string") {
        onImport(text);
      }
      setIsImporting(false);
    };
    reader.readAsText(file, "utf-8");
  };


  // ---------- ENTRADA DE ESTOQUE ----------
  const confirmEntry = () => {
    if (!entryItem || !entryQty) return;
    const value = Number(entryQty);
    if (isNaN(value)) return;

    onUpdateStock(entryItem.id, value, entryItem.name);
    setEntryItem(null);
    setEntryQty("");
  };


  // ---------- CONFIRMAR EXCLUSÃO ----------
  const confirmDelete = () => {
    if (!deleteItem) return;
    onDelete(deleteItem.id);
    setDeleteItem(null);
  };


  // ---------- CONFIRMAR CLEAR ALL ----------
  const confirmClearAll = async () => {
    await onClear();
    setConfirmClear(false);
    alert("Todo o estoque foi limpo.");
  };


  // ---------- FILTRO DE BUSCA ----------
  const filteredInventory = inventory.filter((item) =>
    item.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const logsForHistoryItem = historyItem
    ? stockLogs.filter((log) => log.itemId === historyItem.id)
    : [];


  return (
    <div className="space-y-6">
      {/* TOPO: TÍTULO + AÇÕES */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Package className="text-teal-600" size={18} />
            Estoque de insumos
          </h2>
          <p className="text-xs text-slate-500">
            Cadastre, edite e acompanhe o estoque utilizado na enfermaria.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* BUSCA */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Buscar insumo..."
              className="pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* IMPORTAR INSUMOS */}
          <button
            onClick={() => setIsImporting(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600"
          >
            <Upload size={14} />
            Importar CSV
          </button>

          {/* LIMPAR ESTOQUE */}
          <button
            onClick={() => setConfirmClear(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-red-200 rounded-lg bg-red-50 hover:bg-red-100 text-red-600"
          >
            <Trash2 size={14} />
            Limpar estoque
          </button>

          {/* NOVO ITEM */}
          <button
            onClick={() => setIsAdding((v) => !v)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700"
          >
            <Plus size={14} />
            Novo insumo
          </button>
        </div>
      </div>


      {/* FORM NOVO ITEM */}
      {isAdding && (
        <form
          onSubmit={handleSubmitNew}
          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-xs space-y-3"
        >
          <h3 className="text-sm font-semibold text-slate-700 mb-1">
            Cadastrar novo insumo
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-[11px] mb-1 text-slate-500">
                Nome
              </label>
              <input
                type="text"
                required
                placeholder="Ex: Dipirona 500mg"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                value={newItem.name}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div>
              <label className="block text-[11px] mb-1 text-slate-500">
                Unidade
              </label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                value={newItem.unit}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, unit: e.target.value }))
                }
              >
                <option value="ml">ml</option>
                <option value="mg">mg</option>
                <option value="un">un</option>
                <option value="caixa">caixa</option>
                <option value="ampola">ampola</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] mb-1 text-slate-500">
                Estoque inicial
              </label>
              <input
                type="number"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                value={newItem.quantity}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, quantity: e.target.value }))
                }
                required
              />
            </div>

            <div>
              <label className="block text-[11px] mb-1 text-slate-500">
                Estoque mínimo
              </label>
              <input
                type="number"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                value={newItem.minStock}
                onChange={(e) =>
                  setNewItem((prev) => ({ ...prev, minStock: e.target.value }))
                }
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              onClick={() => setIsAdding(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700"
            >
              Salvar
            </button>
          </div>
        </form>
      )}



      {/* LISTA DE INSUMOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredInventory.map((item) => {
          const q = Number(item.quantity || 0);
          const m = Number(item.minStock || 0);
          const isCritical = q <= m && m > 0;

          return (
            <div
              key={item.id}
              className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col justify-between"
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {item.name}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Unidade: <span className="font-medium">{item.unit}</span>
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    className="p-1 rounded-md hover:bg-slate-100 text-slate-400"
                    title="Histórico"
                    onClick={() => setHistoryItem(item)}
                  >
                    <History size={14} />
                  </button>
                  <button
                    className="p-1 rounded-md hover:bg-slate-100 text-slate-400"
                    title="Editar"
                    onClick={() => setEditItem(item)}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="p-1 rounded-md hover:bg-red-50 text-red-500"
                    title="Excluir"
                    onClick={() => setDeleteItem(item)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-baseline gap-1">
                <span
                  className={`text-2xl font-bold ${
                    isCritical ? "text-red-600" : "text-slate-800"
                  }`}
                >
                  {q}
                </span>
                <span className="text-xs text-slate-400">{item.unit}</span>
              </div>

              <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
                {isCritical && (
                  <AlertTriangle size={11} className="text-red-500" />
                )}
                Mínimo: <span className="font-medium">{m}</span> {item.unit}
              </div>

              <div className="mt-3 pt-2 border-t border-slate-100 flex gap-2">
                <button
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  onClick={() => setEntryItem(item)}
                >
                  + Entrada
                </button>
              </div>
            </div>
          );
        })}

        {filteredInventory.length === 0 && (
          <div className="col-span-full bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-xs text-slate-400">
            Nenhum insumo cadastrado.
          </div>
        )}
      </div>


      {/* MODAL IMPORTAR CSV */}
      {isImporting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full border border-slate-200 shadow-xl text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Importar insumos via CSV
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setIsImporting(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Formato esperado:{" "}
              <span className="font-mono">
                nome,unidade,quantidade,minimo
              </span>
            </p>

            <div className="border-2 border-dashed border-slate-300 rounded-lg py-6 text-center bg-slate-50">
              <Upload className="mx-auto mb-2 text-slate-400" size={20} />
              <p className="text-[11px] text-slate-500 mb-1">
                Clique para selecionar o arquivo .csv
              </p>
              <input
                type="file"
                accept=".csv"
                className="mt-2 text-[11px]"
                onChange={handleFileChange}
              />
            </div>
          </div>
        </div>
      )}


      {/* MODAL ENTRADA DE ESTOQUE */}
      {entryItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full border border-slate-200 shadow-xl text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Entrada de estoque
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => {
                  setEntryItem(null);
                  setEntryQty("");
                }}
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 mb-2">
              Insumo:
              <br />
              <span className="font-semibold text-slate-800">
                {entryItem.name}
              </span>
            </p>

            <label className="block text-[11px] mb-1 text-slate-500">
              Quantidade ({entryItem.unit})
            </label>
            <input
              type="number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20 mb-4"
              value={entryQty}
              onChange={(e) => setEntryQty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmEntry()}
            />

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                onClick={() => {
                  setEntryItem(null);
                  setEntryQty("");
                }}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-1.5 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                onClick={confirmEntry}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}


      {/* MODAL EXCLUIR ITEM */}
      {deleteItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full border border-slate-200 shadow-xl text-xs text-center">
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-3">
              <Trash2 size={18} />
            </div>
            <h3 className="text-sm font-semibold text-slate-800 mb-1">
              Excluir insumo?
            </h3>
            <p className="text-[11px] text-slate-500 mb-4">
              Tem certeza que deseja excluir{" "}
              <span className="font-semibold">{deleteItem.name}</span>?
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                onClick={() => setDeleteItem(null)}
              >
                Cancelar
              </button>
              <button
                className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700"
                onClick={confirmDelete}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}


      {/* MODAL LIMPAR ESTOQUE */}
      {confirmClear && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full border border-slate-200 shadow-xl text-xs text-center">
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-3">
              <Trash2 size={18} />
            </div>
            <h3 className="text-sm font-semibold text-slate-800 mb-1">
              Limpar todo o estoque?
            </h3>
            <p className="text-[11px] text-slate-500 mb-4">
              Esta ação irá apagar <strong>todos os insumos cadastrados</strong>.
              Os agendamentos e histórico não serão apagados.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                onClick={() => setConfirmClear(false)}
              >
                Cancelar
              </button>
              <button
                className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700"
                onClick={confirmClearAll}
              >
                Limpar
              </button>
            </div>
          </div>
        </div>
      )}


      {/* MODAL HISTÓRICO ITEM */}
      {historyItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl p-5 max-w-md w-full border border-slate-200 shadow-xl text-xs">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
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

            <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-2">
              {logsForHistoryItem.length === 0 && (
                <div className="text-[11px] text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-lg">
                  Nenhum registro encontrado.
                </div>
              )}

              {logsForHistoryItem.map((log) => {
                const d = log.createdAt?.seconds
                  ? new Date(log.createdAt.seconds * 1000)
                  : null;
                const isReversal = log.type === "reversal";
                const label =
                  log.type === "usage"
                    ? "Uso em aplicação"
                    : isReversal
                    ? "Estorno"
                    : "Entrada";

                return (
                  <div
                    key={log.id}
                    className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                          log.type === "usage"
                            ? "bg-teal-100 text-teal-700"
                            : isReversal
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {log.type === "usage"
                          ? "-"
                          : "+"}
                        {log.quantity}
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-slate-700">
                          {label}
                        </p>
                        {d && (
                          <p className="text-[10px] text-slate-400">
                            {d.toLocaleDateString("pt-BR")}{" "}
                            {d.toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end">
              <button
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                onClick={() => setHistoryItem(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}


      {/* MODAL EDITAR ITEM */}
      {editItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full border border-slate-200 shadow-xl text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Editar insumo
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setEditItem(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-[11px] mb-1 text-slate-500">
                  Nome
                </label>
                <input
                  type="text"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  value={editItem.name}
                  onChange={(e) =>
                    setEditItem((prev) => ({
                      ...prev,
                      name: e.target.value
                    }))
                  }
                />
              </div>

              <div>
                <label className="block text-[11px] mb-1 text-slate-500">
                  Unidade
                </label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  value={editItem.unit}
                  onChange={(e) =>
                    setEditItem((prev) => ({
                      ...prev,
                      unit: e.target.value
                    }))
                  }
                >
                  <option value="ml">ml</option>
                  <option value="mg">mg</option>
                  <option value="un">un</option>
                  <option value="caixa">caixa</option>
                  <option value="ampola">ampola</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] mb-1 text-slate-500">
                    Quantidade atual
                  </label>
                  <input
                    type="number"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    value={editItem.quantity}
                    onChange={(e) =>
                      setEditItem((prev) => ({
                        ...prev,
                        quantity: e.target.value
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-[11px] mb-1 text-slate-500">
                    Estoque mínimo
                  </label>
                  <input
                    type="number"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    value={editItem.minStock}
                    onChange={(e) =>
                      setEditItem((prev) => ({
                        ...prev,
                        minStock: e.target.value
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                onClick={() => setEditItem(null)}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-1.5 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                onClick={() => {
                  onUpdate(editItem.id, {
                    name: editItem.name,
                    unit: editItem.unit,
                    quantity: Number(editItem.quantity || 0),
                    minStock: Number(editItem.minStock || 0)
                  });
                  setEditItem(null);
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ===============================
// PARTE 3 - HELPERS DE DATA
// ===============================
function getDateFromField(field) {
  if (!field) return null;

  // Se já for Timestamp do Firestore
  if (field instanceof Timestamp) {
    return field.toDate();
  }

  // Se vier como { seconds: number }
  if (field.seconds != null) {
    return new Date(field.seconds * 1000);
  }

  // Se vier como string "YYYY-MM-DD"
  if (typeof field === "string") {
    const d = new Date(field + "T00:00:00");
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function formatDateShort(field) {
  const d = getDateFromField(field);
  if (!d) return "";
  return d.toLocaleDateString("pt-BR");
}


// ===============================
// PARTE 3 - ENFERMARIA (ScheduleTab)
// ===============================
function ScheduleTab({
  inventory,
  schedule,
  onSchedule,
  onApply,
  onUndo,
  onDelete,
  onImportAgenda
}) {
  const [newPatient, setNewPatient] = useState({
    patientName: "",
    date: new Date().toISOString().split("T")[0],
    sessions: 1,
    items: [{ id: Date.now(), medicationId: "", dose: "" }]
  });

  const [applyModalItem, setApplyModalItem] = useState(null);
  const [applyDate, setApplyDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const [isImportingAgenda, setIsImportingAgenda] = useState(false);

  // ---------- LINHAS DE INSUMOS (FORM NOVO) ----------
  const addLine = () => {
    setNewPatient((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { id: Date.now() + Math.random(), medicationId: "", dose: "" }
      ]
    }));
  };

  const removeLine = (id) => {
    setNewPatient((prev) => {
      if (prev.items.length === 1) return prev;
      return {
        ...prev,
        items: prev.items.filter((it) => it.id !== id)
      };
    });
  };

  const updateLine = (id, field, value) => {
    setNewPatient((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id ? { ...it, [field]: value } : it
      )
    }));
  };


  // ---------- SUBMIT NOVO AGENDAMENTO ----------
  const handleSubmit = (e) => {
    e.preventDefault();

    if (!newPatient.patientName.trim()) {
      alert("Informe o nome do paciente.");
      return;
    }

    const cleanItems = newPatient.items
      .filter((it) => it.medicationId && it.dose)
      .map((it) => ({
        medicationId: it.medicationId,
        dose: Number(String(it.dose).replace(",", ".")) || 0
      }));

    if (cleanItems.length === 0) {
      alert("Selecione pelo menos um insumo e dose.");
      return;
    }

    const startDate = new Date(newPatient.date + "T00:00:00");
    if (isNaN(startDate.getTime())) {
      alert("Data inicial inválida.");
      return;
    }

    const sessions = Number(newPatient.sessions) || 1;

    for (let i = 0; i < sessions; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i * 7);
      const dateStr = d.toISOString().split("T")[0];

      onSchedule({
        patientName: newPatient.patientName.trim(),
        date: dateStr,
        items: cleanItems,
        status: "scheduled",
        sessionInfo: sessions > 1 ? `${i + 1}/${sessions}` : null
      });
    }

    setNewPatient({
      patientName: "",
      date: new Date().toISOString().split("T")[0],
      sessions: 1,
      items: [{ id: Date.now(), medicationId: "", dose: "" }]
    });
  };


  // ---------- IMPORTAR CSV DA AGENDA ----------
  // Usa a função onImportAgenda passada pelo App (se existir)
  const handleAgendaFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!onImportAgenda) {
      alert("Função de importação não configurada.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === "string") {
        onImportAgenda(text);
      }
      setIsImportingAgenda(false);
    };
    reader.readAsText(file, "utf-8");
  };


  // ---------- APLICAR PROTOCOLO ----------
  const openApplyModal = (item) => {
    setApplyModalItem(item);
    setApplyDate(new Date().toISOString().split("T")[0]);
  };

  const confirmApply = () => {
    if (!applyModalItem || !applyDate) return;
    onApply(applyModalItem, applyDate);
    setApplyModalItem(null);
  };


  // ---------- LISTAS PENDENTES / HISTÓRICO ----------
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
      const da = s.appliedAt
        ? getDateFromField(s.appliedAt)
        : getDateFromField(s.date);
      const db = b.appliedAt
        ? getDateFromField(b.appliedAt)
        : getDateFromField(b.date);
      return (db?.getTime() || 0) - (da?.getTime() || 0);
    });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const renderMedsSummary = (items) => {
    if (!items || !items.length) return null;
    return (
      <div className="mt-1 space-y-0.5">
        {items.map((it, idx) => {
          const inv = it.medicationId
            ? inventory.find((x) => x.id === it.medicationId)
            : null;

          const name =
            inv?.name ||
            it.medicationName ||
            "Insumo não vinculado ao estoque";

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
      {/* FORMULÁRIO DE AGENDAMENTO */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-xs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Users size={16} className="text-teal-600" />
              Fila de aplicação / Agenda
            </h2>
            <p className="text-[11px] text-slate-500">
              Agende protocolos com um ou mais insumos, com repetição semanal.
            </p>
          </div>

          {onImportAgenda && (
            <button
              onClick={() => setIsImportingAgenda(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
            >
              <Upload size={14} />
              Importar agenda (CSV)
            </button>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 md:grid-cols-12 gap-3"
        >
          {/* Paciente */}
          <div className="md:col-span-12">
            <label className="block text-[11px] mb-1 text-slate-500">
              Paciente
            </label>
            <input
              type="text"
              required
              placeholder="Nome do paciente"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={newPatient.patientName}
              onChange={(e) =>
                setNewPatient((prev) => ({
                  ...prev,
                  patientName: e.target.value
                }))
              }
            />
          </div>

          {/* Insumos do protocolo */}
          <div className="md:col-span-12 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <label className="block text-[11px] mb-1 text-slate-600 font-semibold">
              Insumos do protocolo
            </label>

            {newPatient.items.map((it) => (
              <div
                key={it.id}
                className="flex items-center gap-2 mb-2 last:mb-0"
              >
                <select
                  className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
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
                  placeholder="Dose"
                  className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  value={it.dose}
                  onChange={(e) =>
                    updateLine(it.id, "dose", e.target.value)
                  }
                  required
                />

                {newPatient.items.length > 1 && (
                  <button
                    type="button"
                    className="p-1 rounded-md text-red-400 hover:bg-red-50"
                    onClick={() => removeLine(it.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className="mt-2 text-[11px] text-teal-600 font-medium flex items-center gap-1 hover:underline"
              onClick={addLine}
            >
              <Plus size={12} />
              Adicionar outro insumo
            </button>
          </div>

          {/* Data inicial */}
          <div className="md:col-span-4">
            <label className="block text-[11px] mb-1 text-slate-500">
              Data inicial
            </label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none"
              value={newPatient.date}
              onChange={(e) =>
                setNewPatient((prev) => ({ ...prev, date: e.target.value }))
              }
              required
            />
          </div>

          {/* Repetições */}
          <div className="md:col-span-4">
            <label className="block text-[11px] mb-1 text-slate-500">
              Repetições (semanas)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none"
              value={newPatient.sessions}
              onChange={(e) =>
                setNewPatient((prev) => ({
                  ...prev,
                  sessions: Number(e.target.value || 1)
                }))
              }
              required
            />
          </div>

          <div className="md:col-span-4 flex items-end">
            <button
              type="submit"
              className="w-full px-4 py-2 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center justify-center gap-1"
            >
              <Plus size={14} />
              Agendar protocolo
            </button>
          </div>
        </form>
      </div>


      {/* PAINEL: FILA & HISTÓRICO */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* FILA DE APLICAÇÃO */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Fila de aplicação
            </h3>
            <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
              {pending.length} pendente(s)
            </span>
          </div>

          <div className="space-y-2">
            {pending.length === 0 && (
              <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center text-[11px] text-slate-400">
                Nenhum paciente na fila.
              </div>
            )}

            {pending.map((item) => {
              const d = getDateFromField(item.date);
              const isLate = d ? d < today : false;

              return (
                <div
                  key={item.id}
                  className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-slate-800 truncate">
                        {item.patientName}
                      </p>
                      {item.sessionInfo && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500">
                          {item.sessionInfo}
                        </span>
                      )}
                    </div>

                    {renderMedsSummary(item.items)}

                    <p
                      className={`mt-1 text-[11px] flex items-center gap-1 ${
                        isLate
                          ? "text-red-600 font-semibold"
                          : "text-slate-400"
                      }`}
                    >
                      {isLate && <AlertTriangle size={11} />}
                      Agendado para: {formatDateShort(item.date) || "-"}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <button
                      className="px-3 py-1.5 text-[11px] rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1"
                      onClick={() => openApplyModal(item)}
                    >
                      Aplicar
                      <ArrowRight size={13} />
                    </button>

                    <button
                      className="px-2 py-1 text-[10px] rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50"
                      onClick={() => onDelete(item.id)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* HISTÓRICO RECENTE */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-300" />
            Histórico recente
          </h3>

          <div className="bg-white border border-slate-200 rounded-xl p-2 text-xs max-h-[340px] overflow-y-auto">
            {history.length === 0 && (
              <div className="text-[11px] text-slate-400 text-center py-6">
                Nenhuma aplicação registrada ainda.
              </div>
            )}

            {history.map((item) => {
              const d =
                item.appliedAt || item.date
                  ? getDateFromField(item.appliedAt || item.date)
                  : null;

              return (
                <div
                  key={item.id}
                  className="border-b border-slate-100 last:border-0 px-2 py-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-slate-700 truncate">
                        {item.patientName}
                      </p>
                      {item.sessionInfo && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500">
                          {item.sessionInfo}
                        </span>
                      )}
                    </div>
                    {renderMedsSummary(item.items)}
                  </div>

                  <div className="flex flex-col items-end gap-1 min-w-[80px]">
                    {d && (
                      <>
                        <p className="text-[11px] font-semibold text-slate-700">
                          {d.toLocaleDateString("pt-BR")}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {d.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </p>
                      </>
                    )}

                    <button
                      className="mt-1 px-2 py-1 text-[10px] rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center gap-1"
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


      {/* MODAL APLICAR PROTOCOLO */}
      {applyModalItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full border border-slate-200 shadow-xl text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
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

            {renderMedsSummary(applyModalItem.items)}

            <label className="block text-[11px] mt-3 mb-1 text-slate-500">
              Data real da aplicação
            </label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50 focus:outline-none"
              value={applyDate}
              onChange={(e) => setApplyDate(e.target.value)}
            />

            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                onClick={() => setApplyModalItem(null)}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-1.5 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                onClick={confirmApply}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMPORTAR AGENDA CSV */}
      {isImportingAgenda && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full border border-slate-200 shadow-xl text-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Importar agenda via CSV
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setIsImportingAgenda(false)}
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 mb-3">
              Formato sugerido (com cabeçalho):<br />
              <span className="font-mono">
                patientName,medicationName,dose,date(YYYY-MM-DD)
              </span>
            </p>

            <div className="border-2 border-dashed border-slate-300 rounded-lg py-6 text-center bg-slate-50">
              <Upload className="mx-auto mb-2 text-slate-400" size={20} />
              <p className="text-[11px] text-slate-500 mb-1">
                Clique para selecionar o arquivo .csv
              </p>
              <input
                type="file"
                accept=".csv"
                className="mt-2 text-[11px]"
                onChange={handleAgendaFileChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ===============================
// PARTE 4 - PACIENTES (VISÃO POR PACIENTE)
// ===============================
function PatientsTab({ schedule, inventory, onApply, onUndo }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(null);

  // Lista de pacientes únicos
  const patients = Array.from(
    new Set(schedule.map((s) => (s.patientName || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  // Se não tiver paciente selecionado, seleciona o primeiro da lista
  useEffect(() => {
    if (!selectedPatient && patients.length > 0) {
      setSelectedPatient(patients[0]);
    }
  }, [patients, selectedPatient]);

  const filteredPatients = patients.filter((name) =>
    name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const records = schedule
    .filter((s) => s.patientName === selectedPatient)
    .sort((a, b) => {
      const da =
        a.appliedAt || a.date
          ? getDateFromField(a.appliedAt || a.date)
          : new Date(0);
      const db =
        b.appliedAt || b.date
          ? getDateFromField(b.appliedAt || b.date)
          : new Date(0);
      return (db?.getTime() || 0) - (da?.getTime() || 0);
    });

  const renderMedsSummary = (items) => {
    if (!items || !items.length) return null;
    return (
      <div className="mt-0.5 space-y-0.5">
        {items.map((it, idx) => {
          const inv = it.medicationId
            ? inventory.find((x) => x.id === it.medicationId)
            : null;

          const name =
            inv?.name ||
            it.medicationName ||
            "Insumo não vinculado ao estoque";

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

  const handleQuickApply = (record) => {
    const todayStr = new Date().toISOString().split("T")[0];
    if (
      window.confirm(
        `Aplicar agora o protocolo de ${record.patientName} usando a data de hoje (${todayStr})?`
      )
    ) {
      onApply(record, todayStr);
    }
  };

  const handleQuickUndo = (record) => {
    if (
      window.confirm(
        `Desfazer a aplicação de ${record.patientName} nessa sessão?`
      )
    ) {
      onUndo(record);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* COLUNA ESQUERDA: LISTA DE PACIENTES */}
      <div className="md:col-span-1 bg-white border border-slate-200 rounded-xl p-3 shadow-sm text-xs">
        <h2 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
          <Users size={14} className="text-teal-600" />
          Pacientes
        </h2>

        <div className="mb-2">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder="Buscar paciente..."
              className="w-full pl-6 pr-2 py-1.5 text-[11px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="max-h-[360px] overflow-y-auto space-y-1">
          {filteredPatients.length === 0 && (
            <div className="text-[11px] text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-lg">
              Nenhum paciente encontrado.
            </div>
          )}

          {filteredPatients.map((name) => {
            const total = schedule.filter((s) => s.patientName === name).length;
            const applied = schedule.filter(
              (s) => s.patientName === name && s.status === "applied"
            ).length;

            return (
              <button
                key={name}
                onClick={() => setSelectedPatient(name)}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] border flex items-center justify-between gap-1 ${
                  selectedPatient === name
                    ? "bg-teal-50 border-teal-200 text-teal-700"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{name}</span>
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <span className="font-semibold text-slate-600">
                    {applied}/{total}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* COLUNA DIREITA: HISTÓRICO DO PACIENTE */}
      <div className="md:col-span-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Calendar size={14} className="text-teal-600" />
              Histórico do paciente
            </h2>
            <p className="text-[11px] text-slate-500">
              Visualize todas as sessões, pendentes e já aplicadas.
            </p>
          </div>
          {selectedPatient && (
            <span className="text-[11px] text-slate-500">
              Paciente selecionado:{" "}
              <span className="font-semibold text-slate-700">
                {selectedPatient}
              </span>
            </span>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm text-xs max-h-[430px] overflow-y-auto">
          {!selectedPatient && (
            <div className="text-[11px] text-slate-400 text-center py-6">
              Selecione um paciente na coluna ao lado.
            </div>
          )}

          {selectedPatient && records.length === 0 && (
            <div className="text-[11px] text-slate-400 text-center py-6">
              Nenhum registro de aplicação ou agendamento para esse paciente.
            </div>
          )}

          {records.map((rec) => {
            const isApplied = rec.status === "applied";
            const dateBase = isApplied
              ? rec.appliedAt || rec.date
              : rec.date;
            const d = getDateFromField(dateBase);

            return (
              <div
                key={rec.id}
                className="border-b border-slate-100 last:border-0 py-2 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={`px-2 py-0.5 text-[10px] rounded-full border ${
                        isApplied
                          ? "bg-teal-50 border-teal-200 text-teal-700"
                          : "bg-amber-50 border-amber-200 text-amber-700"
                      }`}
                    >
                      {isApplied ? "Aplicado" : "Pendente"}
                    </span>
                    {rec.sessionInfo && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500">
                        {rec.sessionInfo}
                      </span>
                    )}
                  </div>

                  {renderMedsSummary(rec.items)}

                  <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1">
                    <CalendarClock size={11} />
                    {isApplied ? "Aplicado em:" : "Agendado para:"}{" "}
                    {formatDateShort(dateBase) || "-"}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1 min-w-[90px]">
                  {isApplied ? (
                    <button
                      className="px-2 py-1 text-[10px] rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center gap-1"
                      onClick={() => handleQuickUndo(rec)}
                    >
                      <Clock size={11} />
                      Desfazer
                    </button>
                  ) : (
                    <button
                      className="px-2 py-1 text-[10px] rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1"
                      onClick={() => handleQuickApply(rec)}
                    >
                      Aplicar hoje
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ===============================
// PARTE 4 - PLANEJAMENTO / COMPRAS
// ===============================
function DashboardTab({ inventory, schedule }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Monta análise por insumo
  const map = {};

  inventory.forEach((inv) => {
    map[inv.id] = {
      id: inv.id,
      name: inv.name,
      unit: inv.unit,
      currentStock: Number(inv.quantity || 0),
      minStock: Number(inv.minStock || 0),
      scheduledUsage: 0,
      projectedStock: 0,
      status: "ok",
      depletionDate: null,
      dailyUsage: []
    };
  });

  // Agenda futura (status = scheduled)
  schedule
    .filter((s) => s.status === "scheduled")
    .forEach((s) => {
      const d = getDateFromField(s.date) || today;
      (s.items || []).forEach((it) => {
        if (!it.medicationId) return;
        const row = map[it.medicationId];
        if (!row) return;
        const dose = Number(it.dose || 0);
        row.scheduledUsage += dose;
        row.dailyUsage.push({ date: d, amount: dose });
      });
    });

  // Calcula projeções
  Object.values(map).forEach((row) => {
    row.dailyUsage.sort((a, b) => a.date - b.date);

    let temp = row.currentStock;
    row.dailyUsage.forEach((u) => {
      temp -= u.amount;
      if (temp < 0 && !row.depletionDate) {
        row.depletionDate = u.date;
      }
    });

    row.projectedStock = row.currentStock - row.scheduledUsage;
    if (row.projectedStock < 0) {
      row.status = "critical";
    } else if (row.projectedStock < row.minStock) {
      row.status = "warning";
    } else {
      row.status = "ok";
    }
  });

  const rows = Object.values(map).sort((a, b) => {
    const priority = { critical: 0, warning: 1, ok: 2 };
    return priority[a.status] - priority[b.status];
  });

  const criticalCount = rows.filter((r) => r.status === "critical").length;
  const warningCount = rows.filter((r) => r.status === "warning").length;

  return (
    <div className="space-y-5">
      {/* CARDS RESUMO */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute right-2 top-2 opacity-10">
            <AlertTriangle size={40} className="text-red-600" />
          </div>
          <p className="text-[10px] uppercase tracking-wide text-red-700 font-semibold mb-1">
            Insumos críticos
          </p>
          <p className="text-3xl font-black text-red-800 mb-1">
            {criticalCount}
          </p>
          <p className="text-[11px] text-red-700">
            Não sustentam a agenda atual.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute right-2 top-2 opacity-10">
            <Package size={40} className="text-amber-500" />
          </div>
          <p className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-1">
            Abaixo do mínimo
          </p>
          <p className="text-3xl font-black text-amber-800 mb-1">
            {warningCount}
          </p>
          <p className="text-[11px] text-amber-700">
            Atenção para futura reposição.
          </p>
        </div>

        <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute right-2 top-2 opacity-10">
            <BarChart3 size={40} className="text-teal-600" />
          </div>
          <p className="text-[10px] uppercase tracking-wide text-teal-700 font-semibold mb-1">
            Insumos cadastrados
          </p>
          <p className="text-3xl font-black text-teal-800 mb-1">
            {inventory.length}
          </p>
          <p className="text-[11px] text-teal-700">
            Base de estoque ativa na clínica.
          </p>
        </div>
      </div>

      {/* TABELA DETALHADA */}
      <div>
        <h2 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
          <BarChart3 size={16} className="text-teal-600" />
          Previsão de compras
        </h2>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2">Insumo</th>
                  <th className="px-3 py-2 text-center">Estoque atual</th>
                  <th className="px-3 py-2 text-center">Uso previsto</th>
                  <th className="px-3 py-2 text-center">Saldo projetado</th>
                  <th className="px-3 py-2">Previsão de término</th>
                </tr>
              </thead>
              <tbody className="text-[11px] divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-slate-400"
                    >
                      Nenhum insumo cadastrado para análise.
                    </td>
                  </tr>
                )}

                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-800 font-medium">
                      {row.name}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-600">
                      {row.currentStock}{" "}
                      <span className="text-slate-400 font-normal">
                        {row.unit}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-slate-600">
                      {row.scheduledUsage > 0 ? (
                        <>
                          -{row.scheduledUsage}{" "}
                          <span className="text-slate-400 font-normal">
                            {row.unit}
                          </span>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          row.projectedStock < 0
                            ? "bg-red-100 text-red-700"
                            : row.projectedStock < row.minStock
                            ? "bg-amber-100 text-amber-700"
                            : "bg-teal-100 text-teal-700"
                        }`}
                      >
                        {row.projectedStock} {row.unit}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "critical" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-red-600 font-semibold">
                          <CalendarClock size={12} />
                          {row.depletionDate
                            ? `Esgota em ${row.depletionDate.toLocaleDateString(
                                "pt-BR"
                              )}`
                            : "Esgotado pela agenda atual"}
                        </span>
                      ) : row.status === "warning" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 font-semibold">
                          Atenção à reposição
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-teal-700 font-semibold">
                          <CheckCircle size={12} />
                          Dentro da faixa segura
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Trash2, Plus, Syringe, Users, BarChart3, 
  AlertTriangle, CheckCircle, Package, ArrowRight,
  Droplets, Pill, Activity, Calendar, Search, Filter, X, History, Clock, Repeat, RotateCcw
} from 'lucide-react';

// Importações do Firebase
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, collection, addDoc, updateDoc, 
  deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, increment, Timestamp 
} from 'firebase/firestore';

// --- SUAS CHAVES DO FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyA3we_zXf-NS_WKDE8rOLEVvpWAzsBfkQU",
  authDomain: "clinicaestoquethc.firebaseapp.com",
  projectId: "clinicaestoquethc",
  storageBucket: "clinicaestoquethc.firebasestorage.app",
  messagingSenderId: "700610674954",
  appId: "1:700610674954:web:8f22262a7350808a787af3"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- COMPONENTE PRINCIPAL ---
export default function ClinicStockApp() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('agenda'); 
  const [inventory, setInventory] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [stockLogs, setStockLogs] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null); // Novo estado para mostrar erros

  // --- AUTENTICAÇÃO ---
  useEffect(() => {
    signInAnonymously(auth).catch((error) => {
      console.error("Erro no login:", error);
      setErrorMsg("Erro ao fazer login anônimo: " + error.message);
      setLoading(false);
    });

    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- CARREGAMENTO DE DADOS ---
  useEffect(() => {
    if (!user) return;

    // Função para tratar erros de conexão
    const handleConnError = (err, source) => {
      console.error(`Erro em ${source}:`, err);
      // Traduz erros comuns
      let msg = err.message;
      if (msg.includes("insufficient-permissions")) msg = "Permissão negada. Verifique as Regras de Segurança no Firebase.";
      if (msg.includes("project-not-found")) msg = "Projeto não encontrado. Verifique a configuração.";
      
      setErrorMsg(`Falha ao carregar ${source}: ${msg}`);
      setLoading(false); // Para o carregamento para mostrar o erro
    };

    // 1. Carregar Estoque
    const inventoryRef = collection(db, 'inventory');
    const unsubInventory = onSnapshot(inventoryRef, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setInventory(items);
    }, (err) => handleConnError(err, "Estoque"));

    // 2. Carregar Agenda
    const scheduleRef = collection(db, 'schedule');
    const unsubSchedule = onSnapshot(scheduleRef, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sorted = items.sort((a, b) => new Date(a.date) - new Date(b.date));
      setSchedule(sorted);
      setLoading(false); // Sucesso!
    }, (err) => handleConnError(err, "Agenda"));

    // 3. Carregar Logs
    const logsRef = collection(db, 'stock_logs');
    const unsubLogs = onSnapshot(logsRef, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sortedLogs = items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setStockLogs(sortedLogs);
    }, (err) => console.error("Erro logs (não crítico)", err));

    return () => {
      unsubInventory();
      unsubSchedule();
      unsubLogs();
    };
  }, [user]);

  // --- FUNÇÕES DE AÇÃO ---
  
  const handleAddInventory = async (item) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'inventory'), {
        ...item,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      alert("Erro ao salvar item: " + e.message);
    }
  };

  const handleUpdateStock = async (id, quantityToAdd, itemName) => {
    if (!user) return;
    try {
      const itemRef = doc(db, 'inventory', id);
      await updateDoc(itemRef, {
        quantity: increment(Number(quantityToAdd))
      });

      await addDoc(collection(db, 'stock_logs'), {
        itemId: id,
        itemName: itemName,
        quantity: Number(quantityToAdd),
        type: 'entry',
        createdAt: serverTimestamp()
      });

    } catch (error) {
      console.error("Erro ao atualizar estoque:", error);
      alert("Erro ao atualizar. Tente recarregar a página.");
    }
  };

  const handleDeleteInventory = async (id) => {
    await deleteDoc(doc(db, 'inventory', id));
  };

  const handleSchedulePatient = async (patientData) => {
    if (!user) return;
    await addDoc(collection(db, 'schedule'), {
      ...patientData,
      status: 'scheduled', 
      createdAt: serverTimestamp()
    });
  };

  const handleApply = async (appointment, actualDateString) => {
    if (!user) return;
    
    const stockItem = inventory.find(i => i.id === appointment.medicationId);
    
    if (!stockItem) {
      alert("Erro: Medicamento não encontrado no estoque atual.");
      return;
    }

    if (stockItem.quantity < appointment.dose) {
      alert(`Estoque insuficiente! Você tem ${stockItem.quantity} ${stockItem.unit} mas precisa de ${appointment.dose} ${stockItem.unit}.`);
      return;
    }

    try {
      const datePart = new Date(actualDateString);
      const now = new Date();
      datePart.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
      const finalDate = Timestamp.fromDate(datePart);

      // 1. Subtrair do estoque
      const itemRef = doc(db, 'inventory', appointment.medicationId);
      await updateDoc(itemRef, {
        quantity: increment(-Number(appointment.dose))
      });

      // 2. Marcar como aplicado
      const scheduleRef = doc(db, 'schedule', appointment.id);
      await updateDoc(scheduleRef, {
        status: 'applied',
        appliedAt: finalDate
      });

    } catch (error) {
      console.error("Erro na aplicação:", error);
      alert("Houve um erro ao registrar a aplicação.");
    }
  };

  const handleUndoApply = async (appointment) => {
    if (!user) return;
    
    if (!confirm(`Deseja desfazer a aplicação em ${appointment.patientName}? O estoque será devolvido.`)) {
      return;
    }

    try {
      // 1. Devolver ao estoque
      const itemRef = doc(db, 'inventory', appointment.medicationId);
      await updateDoc(itemRef, {
        quantity: increment(Number(appointment.dose))
      });

      // 2. Registrar log de estorno
      const stockItem = inventory.find(i => i.id === appointment.medicationId);
      await addDoc(collection(db, 'stock_logs'), {
        itemId: appointment.medicationId,
        itemName: stockItem ? stockItem.name : 'Item desconhecido',
        quantity: Number(appointment.dose),
        type: 'reversal',
        createdAt: serverTimestamp()
      });

      // 3. Voltar status para agendado
      const scheduleRef = doc(db, 'schedule', appointment.id);
      await updateDoc(scheduleRef, {
        status: 'scheduled',
        appliedAt: null 
      });

    } catch (error) {
      console.error("Erro ao reverter:", error);
      alert("Erro ao reverter a aplicação.");
    }
  };

  const handleDeleteSchedule = async (id) => {
    await deleteDoc(doc(db, 'schedule', id));
  };

  // --- RENDERIZAÇÃO ---

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-screen text-slate-500 gap-4">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      <p>Conectando ao banco de dados...</p>
    </div>
  );

  // TELA DE ERRO (Importante para diagnosticar)
  if (errorMsg) return (
    <div className="flex flex-col items-center justify-center h-screen bg-red-50 p-6 text-center">
      <AlertTriangle className="h-16 w-16 text-red-500 mb-4" />
      <h2 className="text-2xl font-bold text-red-800 mb-2">Erro de Conexão</h2>
      <p className="text-red-600 max-w-md bg-white p-4 rounded shadow border border-red-100">
        {errorMsg}
      </p>
      <p className="mt-6 text-slate-600 text-sm">
        Verifique se você terminou de criar o Banco de Dados no Console do Firebase.
      </p>
      <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
        Tentar Novamente
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-20 md:pb-0">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 p-4 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-teal-600 p-2 rounded-lg shadow-sm">
              <Activity className="text-white w-5 h-5" />
            </div>
            <h1 className="text-lg md:text-xl font-bold text-slate-700 leading-tight">
              Clinic<span className="text-teal-600">Control</span>
            </h1>
          </div>
          
          <nav className="hidden md:flex gap-2">
            <NavButton active={activeTab === 'agenda'} onClick={() => setActiveTab('agenda')} icon={<Users size={18} />} label="Enfermaria" />
            <NavButton active={activeTab === 'estoque'} onClick={() => setActiveTab('estoque')} icon={<Package size={18} />} label="Estoque" />
            <NavButton active={activeTab === 'compras'} onClick={() => setActiveTab('compras')} icon={<BarChart3 size={18} />} label="Planejamento" />
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto p-4 md:p-6 animate-in fade-in duration-500">
        {activeTab === 'estoque' && (
          <InventoryTab 
            inventory={inventory} 
            stockLogs={stockLogs}
            onAdd={handleAddInventory} 
            onDelete={handleDeleteInventory}
            onUpdateStock={handleUpdateStock}
          />
        )}
        {activeTab === 'agenda' && (
          <ScheduleTab 
            inventory={inventory} 
            schedule={schedule} 
            onSchedule={handleSchedulePatient}
            onApply={handleApply}
            onUndo={handleUndoApply} 
            onDelete={handleDeleteSchedule}
          />
        )}
        {activeTab === 'compras' && (
          <DashboardTab inventory={inventory} schedule={schedule} />
        )}
      </main>

      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-2 flex justify-around z-20 shadow-lg">
        <MobileNavButton active={activeTab === 'agenda'} onClick={() => setActiveTab('agenda')} icon={<Users size={20} />} label="Enfermaria" />
        <MobileNavButton active={activeTab === 'estoque'} onClick={() => setActiveTab('estoque')} icon={<Package size={20} />} label="Estoque" />
        <MobileNavButton active={activeTab === 'compras'} onClick={() => setActiveTab('compras')} icon={<BarChart3 size={20} />} label="Planejamento" />
      </div>
    </div>
  );
}

// --- SUB-COMPONENTES ---

function NavButton({ active, onClick, icon, label }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
        active 
          ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' 
          : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MobileNavButton({ active, onClick, icon, label }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-full p-2 rounded-lg transition-colors ${
        active ? 'text-teal-600 bg-teal-50' : 'text-slate-400'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium mt-1">{label}</span>
    </button>
  );
}

// --- ABA ESTOQUE ---
function InventoryTab({ inventory, stockLogs, onAdd, onDelete, onUpdateStock }) {
  const [newItem, setNewItem] = useState({ name: '', unit: 'ml', quantity: '', minStock: '' });
  const [isAdding, setIsAdding] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [stockEntryItem, setStockEntryItem] = useState(null);
  const [stockEntryValue, setStockEntryValue] = useState('');
  
  const [deleteItem, setDeleteItem] = useState(null); 
  const [historyItem, setHistoryItem] = useState(null); 

  const handleSubmit = (e) => {
    e.preventDefault();
    onAdd({
      name: newItem.name,
      unit: newItem.unit,
      quantity: Number(newItem.quantity),
      minStock: Number(newItem.minStock)
    });
    setNewItem({ name: '', unit: 'ml', quantity: '', minStock: '' });
    setIsAdding(false);
  };

  const handleConfirmEntry = () => {
    if (stockEntryItem && stockEntryValue && !isNaN(stockEntryValue)) {
      onUpdateStock(stockEntryItem.id, stockEntryValue, stockEntryItem.name);
      setStockEntryItem(null);
      setStockEntryValue('');
    }
  };

  const handleConfirmDelete = () => {
    if (deleteItem) {
      onDelete(deleteItem.id);
      setDeleteItem(null);
    }
  };

  const filteredInventory = inventory.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const itemLogs = historyItem 
    ? stockLogs.filter(log => log.itemId === historyItem.id) 
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-700 flex items-center gap-2">
            <Package className="text-teal-600" /> Insumos
          </h2>
          <p className="text-sm text-slate-500">Gerencie o estoque da clínica</p>
        </div>
        
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Buscar insumo..." 
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-sm whitespace-nowrap"
          >
            <Plus size={18} /> <span className="hidden sm:inline">Novo Item</span>
          </button>
        </div>
      </div>

      {/* Modal de Entrada de Estoque */}
      {stockEntryItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-slate-700">Entrada de Estoque</h3>
              <button onClick={() => setStockEntryItem(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <p className="text-sm text-slate-500 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
              Adicionando ao item:<br/>
              <span className="font-bold text-teal-700 text-base">{stockEntryItem.name}</span>
            </p>
            
            <label className="block text-xs font-medium text-slate-500 mb-1">Quantidade a adicionar ({stockEntryItem.unit})</label>
            <input 
              autoFocus
              type="number" 
              className="w-full p-3 border border-slate-200 rounded-lg text-lg mb-6 focus:ring-2 focus:ring-teal-500 outline-none"
              placeholder="0"
              value={stockEntryValue}
              onChange={(e) => setStockEntryValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmEntry()}
            />
            
            <div className="flex gap-2 justify-end w-full">
              <button 
                onClick={() => { setStockEntryItem(null); setStockEntryValue(''); }}
                className="flex-1 px-4 py-3 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleConfirmEntry}
                disabled={!stockEntryValue}
                className="flex-1 px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {deleteItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <Trash2 className="text-red-600" size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-700">Excluir Item?</h3>
              <p className="text-sm text-slate-500 mt-2">
                Tem certeza que deseja remover <strong>{deleteItem.name}</strong> do estoque? Essa ação não pode ser desfeita.
              </p>
            </div>
            
            <div className="flex gap-2 justify-end w-full">
              <button 
                onClick={() => setDeleteItem(null)}
                className="flex-1 px-4 py-3 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleConfirmDelete}
                className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Histórico */}
      {historyItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                  <History size={20} className="text-teal-600" /> Histórico de Entradas
                </h3>
                <p className="text-sm text-slate-500">{historyItem.name}</p>
              </div>
              <button onClick={() => setHistoryItem(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-2">
              {itemLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
                  Nenhum registro de entrada recente.
                </div>
              ) : (
                itemLogs.map(log => (
                  <div key={log.id} className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full shadow-sm ${log.type === 'reversal' ? 'bg-amber-100 text-amber-600' : 'bg-white text-teal-600'}`}>
                        {log.type === 'reversal' ? <RotateCcw size={14} /> : <Plus size={14} />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-700">
                          {log.type === 'reversal' ? 'Devolução' : 'Entrada'} +{log.quantity} {historyItem.unit}
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock size={10} />
                          {log.createdAt ? new Date(log.createdAt.seconds * 1000).toLocaleString('pt-BR') : 'Data desconhecida'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <button 
              onClick={() => setHistoryItem(null)}
              className="mt-4 w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-medium text-sm transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-lg border border-teal-100 animate-in slide-in-from-top-4">
          <h3 className="font-semibold mb-4 text-slate-700 border-b pb-2">Cadastrar Novo Item</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Nome do Medicamento/Insumo</label>
              <input required type="text" placeholder="Ex: Dipirona Sódica" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all" 
                value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Unidade</label>
              <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all"
                value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})}>
                <option value="ml">ml (Mililitros)</option>
                <option value="mg">mg (Miligramas)</option>
                <option value="un">un (Unidades)</option>
                <option value="amp">amp (Ampolas)</option>
                <option value="fr">fr (Frascos)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Estoque Inicial</label>
              <input required type="number" placeholder="0" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all"
                value={newItem.quantity} onChange={e => setNewItem({...newItem, quantity: e.target.value})} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Estoque Mínimo</label>
              <input required type="number" placeholder="Alerta em..." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all"
                value={newItem.minStock} onChange={e => setNewItem({...newItem, minStock: e.target.value})} />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => setIsAdding(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors">Cancelar</button>
            <button type="submit" className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 shadow-md hover:shadow-lg transition-all text-sm font-medium">Salvar Item</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredInventory.map(item => (
          <div key={item.id} className="group bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-teal-100 transition-all duration-200 flex flex-col justify-between relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1 h-full ${item.quantity <= item.minStock ? 'bg-red-500' : 'bg-teal-500'}`} />
            
            <div>
              <div className="flex justify-between items-start pl-3">
                <div className="font-bold text-slate-700 text-lg truncate pr-2" title={item.name}>{item.name}</div>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setHistoryItem(item)} 
                    className="text-slate-300 hover:text-teal-600 p-1 rounded-md hover:bg-teal-50 transition-colors"
                    title="Ver histórico de entradas"
                  >
                    <History size={16} />
                  </button>
                  <button 
                    onClick={() => setDeleteItem(item)} 
                    className="text-slate-300 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors"
                    title="Excluir item"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="flex items-baseline gap-1 mt-2 pl-3">
                <span className={`text-3xl font-bold tracking-tight ${item.quantity <= item.minStock ? 'text-red-600' : 'text-slate-700'}`}>
                  {item.quantity}
                </span>
                <span className="text-sm font-medium text-slate-400">{item.unit}</span>
              </div>
              <div className="text-xs text-slate-400 mt-1 pl-3 flex items-center gap-1">
                {item.quantity <= item.minStock && <AlertTriangle size={12} className="text-red-500" />}
                Mínimo: {item.minStock} {item.unit}
              </div>
            </div>
            
            <div className="mt-5 pt-4 border-t border-slate-50 flex gap-2 pl-3">
               <button 
                onClick={() => setStockEntryItem(item)}
                className="flex-1 bg-slate-50 hover:bg-teal-50 text-slate-600 hover:text-teal-700 py-2 rounded-lg text-sm font-medium border border-slate-100 hover:border-teal-200 flex items-center justify-center gap-2 transition-all"
               >
                 <Plus size={14} /> Entrada
               </button>
            </div>
          </div>
        ))}
        
        {inventory.length === 0 && (
          <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
            <Package className="w-12 h-12 mx-auto text-slate-200 mb-3" />
            <p className="font-medium">Nenhum insumo cadastrado.</p>
            <button onClick={() => setIsAdding(true)} className="text-teal-600 hover:underline mt-2 text-sm">Cadastrar primeiro item</button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- ABA ENFERMARIA (AGENDA) ---
function ScheduleTab({ inventory, schedule, onSchedule, onApply, onUndo, onDelete }) {
  const [newPatient, setNewPatient] = useState({ 
    patientName: '', 
    medicationId: '', 
    dose: '', 
    date: new Date().toISOString().split('T')[0],
    sessions: 1 // Novo campo para quantidade de sessões
  });

  const [applyModalItem, setApplyModalItem] = useState(null);
  const [applyDate, setApplyDate] = useState(new Date().toISOString().split('T')[0]);

  const availableInventory = inventory; 
  const selectedMed = inventory.find(i => i.id === newPatient.medicationId);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Lógica de agendamento em loop
    const startDate = new Date(newPatient.date);
    
    for (let i = 0; i < newPatient.sessions; i++) {
      const appointmentDate = new Date(startDate);
      // Adiciona 7 dias para cada sessão subsequente (intervalo semanal)
      appointmentDate.setDate(startDate.getDate() + (i * 7));
      
      onSchedule({
        ...newPatient,
        dose: Number(newPatient.dose),
        date: appointmentDate.toISOString().split('T')[0],
        sessionInfo: newPatient.sessions > 1 ? `${i + 1}/${newPatient.sessions}` : null
      });
    }

    setNewPatient({ 
      ...newPatient, 
      patientName: '', 
      dose: '', 
      sessions: 1,
      date: new Date().toISOString().split('T')[0]
    });
  };

  const openApplyModal = (item) => {
    setApplyModalItem(item);
    // Tenta sugerir a data agendada, mas se for passado, sugere hoje
    setApplyDate(new Date().toISOString().split('T')[0]);
  };

  const confirmApply = () => {
    if (applyModalItem && applyDate) {
      onApply(applyModalItem, applyDate);
      setApplyModalItem(null);
    }
  };

  const pending = schedule.filter(s => s.status === 'scheduled');
  const history = schedule.filter(s => s.status === 'applied');
  
  const historySorted = [...history].sort((a,b) => b.appliedAt?.seconds - a.appliedAt?.seconds);

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-500 to-emerald-400"></div>
        <h3 className="font-semibold mb-4 text-slate-700 flex items-center gap-2">
          <Calendar size={18} className="text-teal-600" /> Agendar Aplicação
        </h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-500 mb-1">Nome do Paciente</label>
            <input required type="text" placeholder="Nome completo" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all"
              value={newPatient.patientName} onChange={e => setNewPatient({...newPatient, patientName: e.target.value})} />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-500 mb-1">Insumo</label>
            <select required className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all"
              value={newPatient.medicationId} onChange={e => setNewPatient({...newPatient, medicationId: e.target.value})}>
              <option value="">Selecione...</option>
              {availableInventory.map(item => (
                <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Dose {selectedMed ? `(${selectedMed.unit})` : ''}
            </label>
            <input required type="number" step="0.1" placeholder="0" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all"
              value={newPatient.dose} onChange={e => setNewPatient({...newPatient, dose: e.target.value})} />
          </div>
          
          {/* Novos Campos de Data e Sessões */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Início</label>
            <input required type="date" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all"
              value={newPatient.date} onChange={e => setNewPatient({...newPatient, date: e.target.value})} />
          </div>
           <div className="md:col-span-1">
            <label className="block text-xs font-medium text-slate-500 mb-1" title="Número de aplicações (1 por semana)">Sessões</label>
            <input required type="number" min="1" max="50" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all text-center"
              value={newPatient.sessions} onChange={e => setNewPatient({...newPatient, sessions: Number(e.target.value)})} />
          </div>

          <div className="md:col-span-12 mt-2">
            <button type="submit" className="w-full bg-teal-600 text-white p-2.5 rounded-lg hover:bg-teal-700 font-medium shadow-sm transition-colors flex justify-center items-center gap-2">
              <Plus size={16} /> Agendar {newPatient.sessions > 1 ? `(${newPatient.sessions} Sessões)` : 'Aplicação'}
            </button>
          </div>
        </form>
      </div>

      {/* Modal de Confirmação de Aplicação */}
      {applyModalItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                <CheckCircle size={20} className="text-teal-600" /> Confirmar Aplicação
              </h3>
              <button onClick={() => setApplyModalItem(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4">
              <p className="font-bold text-slate-700">{applyModalItem.patientName}</p>
              <p className="text-sm text-slate-500 mt-1">
                {(() => {
                  const med = inventory.find(i => i.id === applyModalItem.medicationId);
                  return `${med ? med.name : '...'} - ${applyModalItem.dose} ${med ? med.unit : ''}`;
                })()}
              </p>
            </div>

            <label className="block text-xs font-medium text-slate-500 mb-1">Data Real da Aplicação</label>
            <input 
              type="date" 
              className="w-full p-3 border border-slate-200 rounded-lg text-lg mb-6 focus:ring-2 focus:ring-teal-500 outline-none"
              value={applyDate}
              onChange={(e) => setApplyDate(e.target.value)}
            />
            
            <div className="flex gap-2 justify-end w-full">
              <button 
                onClick={() => setApplyModalItem(null)}
                className="flex-1 px-4 py-3 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmApply}
                className="flex-1 px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pendentes */}
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-slate-700 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500"></div> Fila de Aplicação
            </h3>
            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-bold">{pending.length}</span>
          </div>
          
          <div className="space-y-3 flex-1">
            {pending.length === 0 && (
              <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400">
                Nenhum paciente na fila.
              </div>
            )}
            {pending.map(item => {
              const med = inventory.find(i => i.id === item.medicationId);
              const isLate = new Date(item.date) < new Date(new Date().setHours(0,0,0,0));
              
              return (
                <div key={item.id} className={`bg-white p-4 rounded-xl shadow-sm border border-slate-100 border-l-4 ${isLate ? 'border-l-red-400' : 'border-l-amber-400'} flex justify-between items-center group hover:shadow-md transition-all`}>
                  <div>
                    <div className="font-bold text-slate-800 text-lg flex items-center gap-2">
                      {item.patientName}
                      {item.sessionInfo && <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">{item.sessionInfo}</span>}
                    </div>
                    <div className="text-sm text-slate-500 flex items-center gap-1">
                      <Syringe size={14} className="text-slate-400" />
                      {med ? med.name : 'Item excluído'} <span className="text-slate-300">|</span> <span className="font-semibold text-teal-600">{item.dose} {med?.unit}</span>
                    </div>
                    <div className={`text-xs mt-1 font-medium ${isLate ? 'text-red-500 flex items-center gap-1' : 'text-slate-400'}`}>
                      {isLate && <AlertTriangle size={10} />}
                      Agendado: {new Date(item.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => onDelete(item.id)}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Cancelar"
                    >
                      <Trash2 size={18} />
                    </button>
                    <button 
                      onClick={() => openApplyModal(item)}
                      className="bg-teal-50 text-teal-700 hover:bg-teal-600 hover:text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all shadow-sm"
                    >
                      Aplicar <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Histórico */}
        <div className="flex flex-col h-full">
          <h3 className="text-lg font-bold text-slate-700 mb-3 flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-slate-300"></div> Histórico Recente
          </h3>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden">
            <div className="divide-y divide-slate-100">
              {historySorted.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">Nenhuma aplicação registrada ainda.</div>
              )}
              {historySorted.slice(0, 8).map(item => {
                const med = inventory.find(i => i.id === item.medicationId);
                return (
                  <div key={item.id} className="p-4 hover:bg-slate-50 transition-colors flex justify-between items-center group">
                    <div>
                      <div className="font-medium text-slate-600 flex items-center gap-2">
                        {item.patientName}
                        {item.sessionInfo && <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded border border-slate-200">{item.sessionInfo}</span>}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {med ? med.name : '...'} • {item.dose} {med?.unit}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <div className="text-xs font-bold text-slate-600">
                           {item.appliedAt ? new Date(item.appliedAt.seconds * 1000).toLocaleDateString('pt-BR') : 'Hoje'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                           {item.appliedAt ? new Date(item.appliedAt.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <CheckCircle size={16} className="text-teal-500" />
                        <button 
                          onClick={() => onUndo(item)}
                          className="p-1.5 text-slate-300 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors ml-1"
                          title="Desfazer aplicação (estornar ao estoque)"
                        >
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {historySorted.length > 8 && (
              <div className="p-3 text-center bg-slate-50 border-t border-slate-100 text-xs text-slate-500 font-medium cursor-pointer hover:bg-slate-100">
                Ver todo histórico
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- ABA PLANEJAMENTO (COMPRAS) ---
function DashboardTab({ inventory, schedule }) {
  const needs = useMemo(() => {
    const analysis = {};

    inventory.forEach(item => {
      analysis[item.id] = {
        name: item.name,
        unit: item.unit,
        currentStock: item.quantity,
        minStock: item.minStock,
        scheduledUsage: 0,
        status: 'ok' 
      };
    });

    schedule.filter(s => s.status === 'scheduled').forEach(s => {
      if (analysis[s.medicationId]) {
        analysis[s.medicationId].scheduledUsage += s.dose;
      }
    });

    Object.keys(analysis).forEach(key => {
      const item = analysis[key];
      const projectedStock = item.currentStock - item.scheduledUsage;

      if (projectedStock < 0) {
        item.status = 'critical'; 
      } else if (projectedStock < item.minStock) {
        item.status = 'warning'; 
      }
    });

    return Object.values(analysis).sort((a, b) => {
       const priority = { critical: 0, warning: 1, ok: 2 };
       return priority[a.status] - priority[b.status];
    });
  }, [inventory, schedule]);

  const criticalItems = needs.filter(n => n.status === 'critical');
  const warningItems = needs.filter(n => n.status === 'warning');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-red-50 p-6 rounded-xl border border-red-100 relative overflow-hidden">
          <div className="absolute right-0 top-0 opacity-10 transform translate-x-2 -translate-y-2">
            <AlertTriangle size={100} className="text-red-500" />
          </div>
          <div className="text-red-800 font-bold mb-1 flex items-center gap-2 text-sm uppercase tracking-wider">
            Críticos
          </div>
          <div className="text-4xl font-black text-red-900 mb-1">{criticalItems.length}</div>
          <div className="text-xs text-red-700 font-medium">Itens faltarão para a agenda atual!</div>
        </div>

        <div className="bg-amber-50 p-6 rounded-xl border border-amber-100 relative overflow-hidden">
           <div className="absolute right-0 top-0 opacity-10 transform translate-x-2 -translate-y-2">
            <Droplets size={100} className="text-amber-500" />
          </div>
           <div className="text-amber-800 font-bold mb-1 flex items-center gap-2 text-sm uppercase tracking-wider">
            Reposição
          </div>
          <div className="text-4xl font-black text-amber-900 mb-1">{warningItems.length}</div>
          <div className="text-xs text-amber-700 font-medium">Abaixo do estoque mínimo</div>
        </div>

        <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 relative overflow-hidden">
           <div className="absolute right-0 top-0 opacity-10 transform translate-x-2 -translate-y-2">
            <Pill size={100} className="text-blue-500" />
          </div>
           <div className="text-blue-800 font-bold mb-1 flex items-center gap-2 text-sm uppercase tracking-wider">
            Cadastro
          </div>
          <div className="text-4xl font-black text-blue-900 mb-1">{inventory.length}</div>
          <div className="text-xs text-blue-700 font-medium">Total de insumos ativos</div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-xl font-bold text-slate-700 flex items-center gap-2">
          <BarChart3 className="text-teal-600" /> Previsão de Compras
        </h3>
        
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="p-4 font-bold text-xs uppercase tracking-wider">Insumo</th>
                  <th className="p-4 font-bold text-xs uppercase tracking-wider text-center">Atual</th>
                  <th className="p-4 font-bold text-xs uppercase tracking-wider text-center">Uso Previsto</th>
                  <th className="p-4 font-bold text-xs uppercase tracking-wider text-center">Saldo Final</th>
                  <th className="p-4 font-bold text-xs uppercase tracking-wider">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {needs.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-semibold text-slate-700">{item.name}</td>
                    <td className="p-4 text-center text-slate-500">
                      {item.currentStock} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                    </td>
                    <td className="p-4 text-center text-slate-500">
                      {item.scheduledUsage > 0 ? (
                        <span className="font-semibold text-slate-700">-{item.scheduledUsage}</span>
                      ) : '-'} <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`px-2.5 py-1 rounded-full font-bold text-xs ${
                        item.currentStock - item.scheduledUsage < 0 ? 'text-red-700 bg-red-100' : 
                        item.currentStock - item.scheduledUsage < item.minStock ? 'text-amber-700 bg-amber-100' : 'text-teal-700 bg-teal-100'
                      }`}>
                        {item.currentStock - item.scheduledUsage} {item.unit}
                      </span>
                    </td>
                    <td className="p-4">
                      {item.status === 'critical' && (
                        <span className="text-red-600 font-bold flex items-center gap-1.5 text-xs uppercase tracking-wide">
                          <AlertTriangle size={14} /> Faltará!
                        </span>
                      )}
                      {item.status === 'warning' && (
                        <span className="text-amber-600 font-bold flex items-center gap-1.5 text-xs uppercase tracking-wide">
                           Comprar
                        </span>
                      )}
                      {item.status === 'ok' && (
                        <span className="text-teal-600 font-bold flex items-center gap-1.5 text-xs uppercase tracking-wide">
                          <CheckCircle size={14} /> OK
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

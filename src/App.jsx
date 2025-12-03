export default function ClinicStockApp() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState<'agenda' | 'estoque' | 'compras'>('agenda'); 
  const [inventory, setInventory] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [stockLogs, setStockLogs] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

    const handleConnError = (err: any, source: string) => {
      console.error(`Erro em ${source}:`, err);
      let msg = err.message;
      if (msg.includes("insufficient-permissions")) {
        msg = "Permissão negada. Verifique as Regras de Segurança no Firebase.";
      }
      setErrorMsg(`Falha ao carregar ${source}: ${msg}`);
      setLoading(false);
    };

    const inventoryRef = collection(db, 'inventory');
    const unsubInventory = onSnapshot(
      inventoryRef,
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setInventory(items);
      },
      (err) => handleConnError(err, "Estoque")
    );

    const scheduleRef = collection(db, 'schedule');
    const unsubSchedule = onSnapshot(
      scheduleRef,
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const sorted = items.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        setSchedule(sorted);
        setLoading(false);
      },
      (err) => handleConnError(err, "Agenda")
    );

    const logsRef = collection(db, 'stock_logs');
    const unsubLogs = onSnapshot(
      logsRef,
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const sortedLogs = items.sort(
          (a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
        );
        setStockLogs(sortedLogs);
      },
      (err) => console.error("Erro logs", err)
    );

    return () => {
      unsubInventory();
      unsubSchedule();
      unsubLogs();
    };
  }, [user]);

  // --- FUNÇÕES DE AÇÃO ---
  const handleAddInventory = async (item: any) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'inventory'), {
        ...item,
        createdAt: serverTimestamp()
      });
    } catch (e: any) {
      alert("Erro ao salvar item: " + e.message);
    }
  };

  const handleImportCSV = async (csvText: string) => {
    if (!user) return;
    try {
      const rows = csvText.split('\n');
      const batch = writeBatch(db);
      let count = 0;

      rows.forEach(row => {
        const cols = row.split(',').map(c => c.trim());
        if (cols.length >= 3) {
          const newItemRef = doc(collection(db, 'inventory'));
          batch.set(newItemRef, {
            name: cols[0],
            unit: cols[1] || 'un',
            quantity: Number(cols[2]) || 0,
            minStock: Number(cols[3]) || 5,
            createdAt: serverTimestamp()
          });
          count++;
        }
      });

      await batch.commit();
      alert(`${count} itens importados com sucesso!`);
    } catch (e) {
      console.error(e);
      alert("Erro na importação. Verifique o formato do arquivo.");
    }
  };

  const handleUpdateStock = async (id: string, quantityToAdd: number, itemName: string) => {
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
      alert("Erro ao atualizar.");
    }
  };

  const handleDeleteInventory = async (id: string) => {
    await deleteDoc(doc(db, 'inventory', id));
  };

  const handleSchedulePatient = async (patientData: any) => {
    if (!user) return;
    await addDoc(collection(db, 'schedule'), {
      ...patientData,
      status: 'scheduled',
      createdAt: serverTimestamp()
    });
  };

  const handleEditSchedule = async (id: string, updatedData: any) => {
    if (!user) return;
    try {
      const scheduleRef = doc(db, 'schedule', id);
      await updateDoc(scheduleRef, {
        ...updatedData,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Erro ao editar agendamento:", error);
      alert("Erro ao salvar alterações.");
    }
  };

  const handleApply = async (appointment: any, actualDateString: string) => {
    if (!user) return;

    const itemsToProcess =
      appointment.items || [{ medicationId: appointment.medicationId, dose: appointment.dose }];

    for (const reqItem of itemsToProcess) {
      const stockItem = inventory.find(i => i.id === reqItem.medicationId);
      if (!stockItem) {
        alert(`Erro: Insumo não encontrado no estoque.`);
        return;
      }
      if (stockItem.quantity < reqItem.dose) {
        alert(
          `Estoque insuficiente de ${stockItem.name}! Tem ${stockItem.quantity}, precisa de ${reqItem.dose}.`
        );
        return;
      }
    }

    try {
      const datePart = new Date(actualDateString);
      const now = new Date();
      datePart.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
      const finalDate = Timestamp.fromDate(datePart);

      const batch = writeBatch(db);

      itemsToProcess.forEach((reqItem: any) => {
        const itemRef = doc(db, 'inventory', reqItem.medicationId);
        batch.update(itemRef, { quantity: increment(-Number(reqItem.dose)) });
      });

      const scheduleRef = doc(db, 'schedule', appointment.id);
      batch.update(scheduleRef, {
        status: 'applied',
        appliedAt: finalDate
      });

      await batch.commit();
    } catch (error) {
      console.error("Erro na aplicação:", error);
      alert("Houve um erro ao registrar a aplicação.");
    }
  };

  const handleUndoApply = async (appointment: any) => {
    if (!user) return;
    if (!confirm(`Deseja desfazer a aplicação em ${appointment.patientName}?`)) return;

    try {
      const itemsToProcess =
        appointment.items || [{ medicationId: appointment.medicationId, dose: appointment.dose }];

      const batch = writeBatch(db);

      itemsToProcess.forEach((reqItem: any) => {
        const itemRef = doc(db, 'inventory', reqItem.medicationId);
        batch.update(itemRef, { quantity: increment(Number(reqItem.dose)) });

        const newLogRef = doc(collection(db, 'stock_logs'));
        const stockItem = inventory.find(i => i.id === reqItem.medicationId);
        batch.set(newLogRef, {
          itemId: reqItem.medicationId,
          itemName: stockItem ? stockItem.name : 'Item estornado',
          quantity: Number(reqItem.dose),
          type: 'reversal',
          createdAt: serverTimestamp()
        });
      });

      const scheduleRef = doc(db, 'schedule', appointment.id);
      batch.update(scheduleRef, {
        status: 'scheduled',
        appliedAt: null
      });

      await batch.commit();
    } catch (error) {
      console.error("Erro ao reverter:", error);
      alert("Erro ao reverter.");
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    await deleteDoc(doc(db, 'schedule', id));
  };

  // --- RENDERIZAÇÃO ESTADOS GERAIS ---

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-slate-500 gap-4 bg-slate-50">
        <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-teal-600" />
        <p className="text-sm font-medium">Carregando sistema da enfermaria...</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-red-50 p-6 text-center">
        <AlertTriangle className="h-16 w-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-red-800 mb-2">Erro de Conexão</h2>
        <p className="text-red-600 max-w-md bg-white p-4 rounded shadow border border-red-100">
          {errorMsg}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // --- MÉTRICAS RÁPIDAS PARA O HEADER ---
  const pendingCount = schedule.filter(s => s.status === 'scheduled').length;
  const appliedTodayCount = schedule.filter(s => {
    if (s.status !== 'applied' || !s.appliedAt?.seconds) return false;
    const d = new Date(s.appliedAt.seconds * 1000);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;
  const lowStockCount = inventory.filter(i => i.quantity <= i.minStock).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-teal-50 text-slate-800 pb-20 lg:pb-6">
      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-4 p-4 md:p-6">
        {/* SIDEBAR DESKTOP */}
        <aside className="hidden lg:flex lg:flex-col w-64 bg-white/80 border border-slate-200 rounded-2xl shadow-sm p-5 backdrop-blur">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-teal-600 p-2.5 rounded-xl shadow-sm">
              <Activity className="text-white w-5 h-5" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-800 leading-tight">
                Clinic<span className="text-teal-600">Control</span>
              </div>
              <p className="text-[11px] text-slate-400 uppercase tracking-wide">
                Enfermaria & Estoque
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <NavButton
              active={activeTab === 'agenda'}
              onClick={() => setActiveTab('agenda')}
              icon={<Users size={18} />}
              label="Enfermaria"
            />
            <NavButton
              active={activeTab === 'estoque'}
              onClick={() => setActiveTab('estoque')}
              icon={<Package size={18} />}
              label="Estoque"
            />
            <NavButton
              active={activeTab === 'compras'}
              onClick={() => setActiveTab('compras')}
              icon={<BarChart3 size={18} />}
              label="Planejamento"
            />
          </div>

          <div className="mt-auto pt-4 border-t border-slate-100 text-[11px] text-slate-400">
            <p>Sessão anônima ativa</p>
            <p className="mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date().toLocaleString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
              })}{" "}
              · Online
            </p>
          </div>
        </aside>

        {/* COLUNA PRINCIPAL */}
        <section className="flex-1 flex flex-col gap-4">
          {/* HEADER PRINCIPAL */}
          <header className="bg-white/80 border border-slate-200 rounded-2xl shadow-sm p-4 md:p-5 backdrop-blur">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="lg:hidden bg-teal-600 p-2.5 rounded-xl shadow-sm">
                  <Activity className="text-white w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-lg md:text-xl font-bold text-slate-800 leading-tight">
                    Painel da <span className="text-teal-600">Enfermaria</span>
                  </h1>
                  <p className="text-xs md:text-[13px] text-slate-500">
                    Agenda de aplicações, consumo de insumos e previsão de compras em um único lugar.
                  </p>
                </div>
              </div>
            </div>

            {/* CARDS DE MÉTRICA */}
            <div className="mt-4 grid grid-cols-3 gap-2 md:gap-4">
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 md:px-4 md:py-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] md:text-xs font-semibold text-amber-700 uppercase tracking-wide">
                    Fila de aplicação
                  </p>
                  <p className="text-lg md:text-2xl font-black text-amber-900 leading-tight">
                    {pendingCount}
                  </p>
                </div>
                <Users className="w-5 h-5 md:w-6 md:h-6 text-amber-500 opacity-80" />
              </div>

              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5 md:px-4 md:py-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] md:text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                    Aplicados hoje
                  </p>
                  <p className="text-lg md:text-2xl font-black text-emerald-900 leading-tight">
                    {appliedTodayCount}
                  </p>
                </div>
                <CheckCircle className="w-5 h-5 md:w-6 md:h-6 text-emerald-500 opacity-80" />
              </div>

              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 md:px-4 md:py-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] md:text-xs font-semibold text-red-700 uppercase tracking-wide">
                    Insumos críticos
                  </p>
                  <p className="text-lg md:text-2xl font-black text-red-900 leading-tight">
                    {lowStockCount}
                  </p>
                </div>
                <AlertTriangle className="w-5 h-5 md:w-6 md:h-6 text-red-500 opacity-80" />
              </div>
            </div>
          </header>

          {/* CONTEÚDO DAS ABAS */}
          <main className="bg-white/90 border border-slate-200 rounded-2xl shadow-sm p-4 md:p-6 flex-1 animate-in fade-in duration-300">
            {activeTab === 'estoque' && (
              <InventoryTab
                inventory={inventory}
                stockLogs={stockLogs}
                onAdd={handleAddInventory}
                onImport={handleImportCSV}
                onDelete={handleDeleteInventory}
                onUpdateStock={handleUpdateStock}
              />
            )}

            {activeTab === 'agenda' && (
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

            {activeTab === 'compras' && (
              <DashboardTab inventory={inventory} schedule={schedule} />
            )}
          </main>
        </section>
      </div>

      {/* NAV MOBILE FIXA */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-2 flex justify-around z-20 shadow-lg">
        <MobileNavButton
          active={activeTab === 'agenda'}
          onClick={() => setActiveTab('agenda')}
          icon={<Users size={20} />}
          label="Enfermaria"
        />
        <MobileNavButton
          active={activeTab === 'estoque'}
          onClick={() => setActiveTab('estoque')}
          icon={<Package size={20} />}
          label="Estoque"
        />
        <MobileNavButton
          active={activeTab === 'compras'}
          onClick={() => setActiveTab('compras')}
          icon={<BarChart3 size={20} />}
          label="Planejamento"
        />
      </div>
    </div>
  );
}

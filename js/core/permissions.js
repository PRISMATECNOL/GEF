/**
 * GEF - GESTÃO FINANCEIRA | CORE PERMISSIONS
 * JavaScript Puro (Vanilla JS)
 */

// Papéis válidos, iguais aos definidos no banco (public.profiles.role).
// ATENÇÃO: esta função só NORMALIZA o texto do papel vindo de public.profiles para
// exibir menus. Nunca deduz privilégios a partir de e-mail ou de ID: a segurança real
// está nas policies RLS e nas RPCs do PostgreSQL, não neste arquivo.
// v7: o perfil efectivo (Super Embaixador ou Embaixador) é decidido no servidor; fica só uma dica local para o rótulo do menu.
function ambassadorMenuLabel() {
  try {
    return window.localStorage.getItem('gef_amb_profile') === 'SUPER_EMBAIXADOR' ? 'Painel do Super Embaixador' : 'Painel do Embaixador';
  } catch (e) {
    return 'Painel do Embaixador';
  }
}

export function normalizeRole(role) {
  if (typeof role === 'object' && role !== null) role = role.role;
  const clean = (role || '').toString().trim().toUpperCase();
  switch (clean) {
    case 'SUPERADMIN':
    case 'ADMIN':
    case 'GERENTE':
    case 'ESTOQUISTA':
    case 'EMBAIXADOR':
    case 'CASHIER':
    case 'MARKETING':
    case 'LOGISTA':
      return clean;
    default:
      return 'CASHIER'; // menor privilégio por omissão
  }
}

export function getDefaultTabForRole(role, userId) {
  const norm = normalizeRole(role, userId);
  switch (norm) {
    case 'SUPERADMIN':
      return 'MONITOR_SAAS';
    case 'ADMIN':
      return 'DASHBOARD';
    case 'GERENTE':
      return 'DASHBOARD';
    case 'CASHIER':
      return 'PDV';
    case 'ESTOQUISTA':
      return 'ESTOQUE';
    case 'MARKETING':
      return 'LOJA_VIRTUAL';
    case 'LOGISTA':
      return 'LOGISTICA';
    case 'EMBAIXADOR':
      return 'EMBAIXADORES';
    default:
      return 'PDV';
  }
}

export const ROLE_ALLOWED_TABS = {
  SUPERADMIN: [
    'MONITOR_SAAS',
    'LOJAS',
    'EMBAIXADORES',
    'AUDITORIA',
    'RELATORIOS',
    'CONFIGURACOES',
    'DASHBOARD',
    'PDV',
    'VENDAS',
    'ORCAMENTOS',
    'PRODUTOS',
    'ESTOQUE',
    'TRANSFERENCIAS',
    'PERDAS',
    'COMPRAS',
    'ENTREGAS',
    'CAIXA',
    'CLIENTES'
  ],
  ADMIN: [
    'DASHBOARD',
    'PDV',
    'VENDAS',
    'ORCAMENTOS',
    'PRODUTOS',
    'LOJA_VIRTUAL',
    'ESTOQUE',
    'TRANSFERENCIAS',
    'PERDAS',
    'COMPRAS',
    'ENTREGAS',
    'LOGISTICA',
    'CAIXA',
    'CLIENTES',
    'RELATORIOS',
    'AUDITORIA',
    'CONFIGURACOES'
  ],
  GERENTE: [
    'DASHBOARD',
    'PDV',
    'VENDAS',
    'ORCAMENTOS',
    'PRODUTOS',
    'LOJA_VIRTUAL',
    'ESTOQUE',
    'TRANSFERENCIAS',
    'PERDAS',
    'COMPRAS',
    'ENTREGAS',
    'LOGISTICA',
    'CAIXA',
    'CLIENTES',
    'RELATORIOS',
    'AUDITORIA'
  ],
  CASHIER: [
    'PDV',
    'VENDAS',
    'CAIXA',
    'CLIENTES'
  ],
  ESTOQUISTA: [
    'ESTOQUE',
    'PRODUTOS',
    'TRANSFERENCIAS',
    'PERDAS',
    'COMPRAS',
    'ENTREGAS',
    'AUDITORIA'
  ],
  EMBAIXADOR: [
    'EMBAIXADORES'
  ],
  // Equipa de Marketing e Vendas: promoções, notificações, clientes e encomendas (leitura) com comprovativos
  MARKETING: [
    'LOJA_VIRTUAL'
  ],
  // Logistas: organizam os produtos pedidos e marcam «Pronta para entrega»
  LOGISTA: [
    'LOGISTICA'
  ]
};

export function isTabAllowedForUser(tab, userOrRole, userId) {
  if (!userOrRole) return false;
  let norm;
  if (typeof userOrRole === 'object') {
    norm = normalizeRole(userOrRole.role, userOrRole.id);
  } else {
    norm = normalizeRole(userOrRole, userId);
  }
  const allowed = ROLE_ALLOWED_TABS[norm] || ROLE_ALLOWED_TABS.CASHIER;
  return allowed.includes(tab);
}

/**
 * v24 - CONFIDENCIALIDADE: valores e custos de estoque (custo unitário, valor de estoque, valor de perdas/compras,
 * divergências financeiras) NÃO são visíveis ao ESTOQUISTA. Só quantidades. Os restantes perfis mantêm o que já viam.
 * (Esta função só controla a apresentação; a segurança dos dados continua nas policies RLS.)
 */
export function canViewStockValues(userOrRole) {
  const norm = normalizeRole(typeof userOrRole === 'object' && userOrRole !== null ? userOrRole.role : userOrRole);
  return norm !== 'ESTOQUISTA';
}

/** v24 - Quem pode validar/recusar pagamentos de encomendas online (o servidor impõe a mesma regra). */
export function canValidatePayments(userOrRole) {
  const norm = normalizeRole(typeof userOrRole === 'object' && userOrRole !== null ? userOrRole.role : userOrRole);
  return ['SUPERADMIN', 'ADMIN', 'GERENTE', 'MARKETING'].includes(norm);
}

export function canSwitchStores(user) {
  if (!user) return false;
  const norm = normalizeRole(user.role, user.id);
  return norm === 'SUPERADMIN' || (norm === 'ADMIN' && user.storeId === 'ALL');
}

export function getRoleBadgeInfo(role, userId) {
  const norm = normalizeRole(role, userId);
  switch (norm) {
    case 'SUPERADMIN':
      return {
        label: 'Superadmin SaaS Global',
        badgeClass: 'badge-amber'
      };
    case 'ADMIN':
      return {
        label: 'Administrador da Loja',
        badgeClass: 'badge-blue'
      };
    case 'GERENTE':
      return {
        label: 'Gerente de Filial',
        badgeClass: 'badge-orange'
      };
    case 'CASHIER':
      return {
        label: 'Operador de Caixa',
        badgeClass: 'badge-emerald'
      };
    case 'ESTOQUISTA':
      return {
        label: 'Encarregado de Estoque',
        badgeClass: 'badge-blue'
      };
    case 'EMBAIXADOR':
      return {
        label: 'Embaixador Parceiro',
        badgeClass: 'badge-red'
      };
    case 'MARKETING':
      return {
        label: 'Marketing & Vendas',
        badgeClass: 'badge-amber'
      };
    case 'LOGISTA':
      return {
        label: 'Logista',
        badgeClass: 'badge-emerald'
      };
    default:
      return {
        label: 'Operador',
        badgeClass: 'badge-blue'
      };
  }
}

export function getNavSectionsForRole(role, userId) {
  const norm = normalizeRole(role, userId);
  if (norm === 'SUPERADMIN') {
    return [
      {
        label: 'PAINEL SAAS GLOBAL',
        items: [
          { id: 'MONITOR_SAAS', label: 'Monitor SaaS & Trava', icon: 'shield-check', highlight: true },
          { id: 'LOJAS', label: 'Gestão de Filiais', icon: 'building-2' },
          { id: 'EMBAIXADORES', label: 'Gestão de Embaixadores', icon: 'award' }
        ]
      },
      {
        label: 'GOVERNANÇA & SISTEMA',
        items: [
          { id: 'AUDITORIA', label: 'Auditoria & Inventário', icon: 'clipboard-check' },
          { id: 'RELATORIOS', label: 'Relatórios Consolidados', icon: 'file-bar-chart' },
          { id: 'CONFIGURACOES', label: 'Configurações da Plataforma', icon: 'settings' }
        ]
      }
    ];
  }
  if (norm === 'ADMIN') {
    return [
      {
        label: 'VISÃO GERAL',
        items: [
          { id: 'DASHBOARD', label: 'Painel da Loja', icon: 'layout-dashboard' }
        ]
      },
      {
        label: 'FRENTE DE VENDAS',
        items: [
          { id: 'PDV', label: 'Frente de Caixa (PDV)', icon: 'shopping-cart', highlight: true },
          { id: 'VENDAS', label: 'Vendas & Estornos', icon: 'receipt' },
          { id: 'ORCAMENTOS', label: 'Orçamentos de Obras', icon: 'file-spreadsheet' }
        ]
      },
      {
        label: 'ESTOQUE & LOGÍSTICA',
        items: [
          { id: 'PRODUTOS', label: 'Catálogo de Produtos', icon: 'package' },
          { id: 'LOJA_VIRTUAL', label: 'Loja Virtual & Encomendas', icon: 'store' },
          { id: 'ESTOQUE', label: 'Estoque & Matriz FEFO', icon: 'layers' },
          { id: 'TRANSFERENCIAS', label: 'Transferências Internas', icon: 'arrow-left-right' },
          { id: 'PERDAS', label: 'Perdas & Descartes', icon: 'trash-2' },
          { id: 'COMPRAS', label: 'Compras & Entrada', icon: 'building' },
          { id: 'ENTREGAS', label: 'Entregas', icon: 'truck' },
          { id: 'LOGISTICA', label: 'Logística de Encomendas', icon: 'truck' }
        ]
      },
      {
        label: 'FINANCEIRO & GESTÃO',
        items: [
          { id: 'CAIXA', label: 'Caixa & Fechamento', icon: 'landmark' },
          { id: 'CLIENTES', label: 'Clientes & Fiado', icon: 'users' },
          { id: 'RELATORIOS', label: 'Relatórios & DRE', icon: 'file-bar-chart' },
          { id: 'AUDITORIA', label: 'Auditoria & Inventário', icon: 'clipboard-check' },
          { id: 'CONFIGURACOES', label: 'Configurações da Loja', icon: 'settings' }
        ]
      }
    ];
  }
  if (norm === 'GERENTE') {
    return [
      {
        label: 'VISÃO GERAL',
        items: [
          { id: 'DASHBOARD', label: 'Painel Operacional', icon: 'layout-dashboard' }
        ]
      },
      {
        label: 'VENDAS & ATENDIMENTO',
        items: [
          { id: 'PDV', label: 'Frente de Caixa (PDV)', icon: 'shopping-cart', highlight: true },
          { id: 'VENDAS', label: 'Vendas & Estornos', icon: 'receipt' },
          { id: 'ORCAMENTOS', label: 'Orçamentos de Obras', icon: 'file-spreadsheet' }
        ]
      },
      {
        label: 'ESTOQUE & PÁTIO',
        items: [
          { id: 'PRODUTOS', label: 'Catálogo de Produtos', icon: 'package' },
          { id: 'LOJA_VIRTUAL', label: 'Loja Virtual & Encomendas', icon: 'store' },
          { id: 'ESTOQUE', label: 'Estoque & Armazém', icon: 'layers' },
          { id: 'AUDITORIA', label: 'Auditoria & Inventário', icon: 'clipboard-check' },
          { id: 'TRANSFERENCIAS', label: 'Transferências Internas', icon: 'arrow-left-right' },
          { id: 'PERDAS', label: 'Perdas & Avarias', icon: 'trash-2' },
          { id: 'COMPRAS', label: 'Recebimento de Cargas', icon: 'building' },
          { id: 'ENTREGAS', label: 'Entregas', icon: 'truck' },
          { id: 'LOGISTICA', label: 'Logística de Encomendas', icon: 'truck' }
        ]
      },
      {
        label: 'FINANCEIRO DA LOJA',
        items: [
          { id: 'CAIXA', label: 'Caixa & Fechamentos', icon: 'landmark' },
          { id: 'CLIENTES', label: 'Clientes & Fiado', icon: 'users' },
          { id: 'RELATORIOS', label: 'Relatórios da Loja', icon: 'file-bar-chart' }
        ]
      }
    ];
  }
  if (norm === 'CASHIER') {
    return [
      {
        label: 'FRENTE DE CAIXA',
        items: [
          { id: 'PDV', label: 'Frente de Caixa (PDV)', icon: 'shopping-cart', highlight: true },
          { id: 'VENDAS', label: 'Vendas do Turno', icon: 'receipt' },
          { id: 'CAIXA', label: 'Movimento de Caixa', icon: 'landmark' },
          { id: 'CLIENTES', label: 'Consulta de Clientes', icon: 'users' }
        ]
      }
    ];
  }
  if (norm === 'ESTOQUISTA') {
    return [
      {
        label: 'ARMAZÉM & PÁTIO',
        items: [
          { id: 'ESTOQUE', label: 'Estoque & Matriz FEFO', icon: 'layers', highlight: true },
          { id: 'AUDITORIA', label: 'Inventário & Confrontação', icon: 'clipboard-check' },
          { id: 'PRODUTOS', label: 'Catálogo de Produtos', icon: 'package' },
          { id: 'TRANSFERENCIAS', label: 'Transferências Internas', icon: 'arrow-left-right' },
          { id: 'PERDAS', label: 'Perdas & Descartes', icon: 'trash-2' },
          { id: 'COMPRAS', label: 'Entrada de Mercadorias', icon: 'building' },
          { id: 'ENTREGAS', label: 'Separação de Entregas', icon: 'truck' }
        ]
      }
    ];
  }
  if (norm === 'MARKETING') {
    return [
      {
        label: 'MARKETING & VENDAS',
        items: [
          { id: 'LOJA_VIRTUAL', label: 'Encomendas, Promoções & Notificações', icon: 'store', highlight: true }
        ]
      }
    ];
  }
  if (norm === 'LOGISTA') {
    return [
      {
        label: 'LOGÍSTICA',
        items: [
          { id: 'LOGISTICA', label: 'Preparação de Encomendas', icon: 'truck', highlight: true }
        ]
      }
    ];
  }
  if (norm === 'EMBAIXADOR') {
    return [
      {
        label: 'PROGRAMA DE PARCEIROS',
        items: [
          { id: 'EMBAIXADORES', label: ambassadorMenuLabel(), icon: 'award', highlight: true }
        ]
      }
    ];
  }
  return [];
}

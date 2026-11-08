// Bilingual Dictionary and Internationalization Module (EN / SI)

export const translations = {
  en: {
    app_title: "MRIA Management Welfare Association",
    app_subtitle: "Official Member Portal & Financial Ledger",
    sign_in_google: "Sign in with Google",
    signing_in: "Signing in...",
    sign_out: "Sign Out",
    welcome: "Welcome",
    role_admin: "Administrator",
    role_manager: "Manager",
    role_official: "Official",
    role_treasurer: "Treasurer",
    role_member: "Member",
    
    // Dashboard Stats
    outstanding_dues: "Outstanding Dues",
    current_month_status: "Current Month Status",
    total_benefits_claimed: "Total Benefits Claimed",
    paid: "Paid",
    pending: "Pending",
    overdue: "Overdue",
    settled: "Settled",
    due_rule_warning: "Dues must be settled on or before the 31st of each month.",
    
    // Actions
    upload_slip: "Upload Bank Slip",
    apply_benefit: "Apply for Welfare Benefit",
    view_receipt: "Digital Receipt",
    contact_admin: "Contact Administration",
    
    // Bank QR
    bank_qr_title: "Bank Transfer QR Code",
    bank_name: "Bank of Ceylon",
    branch: "Mattala Branch",
    acc_name: "MRIA Management Welfare Association",
    acc_number: "Account Number",
    
    // Ledger & Tables
    dues_history: "Monthly Dues History",
    billing_month: "Billing Month",
    amount: "Amount (LKR)",
    status: "Status",
    date: "Date",
    actions: "Actions",
    no_records: "No records found.",
    
    // Payment History
    payment_history: "Payment & Slip Submissions",
    payment_type: "Payment Type",
    payment_method: "Method",
    category_monthly_due: "Monthly Due",
    category_admission_fee: "Admission Fee",
    category_donation: "Donation",
    status_pending_approval: "Pending Approval",
    status_verified: "Verified",
    status_rejected: "Rejected",
    
    // Modals
    upload_slip_modal_title: "Upload Bank Payment Slip",
    select_category: "Select Payment Category",
    enter_amount: "Payment Amount (LKR)",
    drop_file_here: "Drag and drop bank slip (JPEG, PNG, or PDF max 5MB)",
    choose_file: "Choose File",
    submit_slip: "Submit Payment Slip",
    submitting: "Submitting...",
    
    claim_modal_title: "Apply for Welfare Benefit",
    select_benefit_type: "Benefit Type",
    claim_amount: "Claim Amount (LKR)",
    claim_notes: "Description / Notes",
    submit_claim: "Submit Application",
    
    // Unauthorized screen
    unauthorized_title: "Access Restricted",
    unauthorized_msg: "You are not yet registered as an approved member of the MRIA Management Welfare Association. Please reach out to the welfare administration to request membership activation.",
    contact_whatsapp_btn: "Contact on WhatsApp: 0759555924",
    call_phone_btn: "Call Administrator: 0759555924",
    
    // Admin Console
    admin_console: "Management Console",
    tab_slips: "Slip Approval Queue",
    tab_cash: "Direct Cash Collection",
    tab_defaulters: "Defaulters Roster (31st Rule)",
    tab_members: "Member Management & RBAC",
    tab_settings: "System Settings & Bank QR",
    tab_claims: "Welfare Claims",
    
    approve_slip: "Approve & Settle Dues (FIFO)",
    reject_slip: "Reject Slip",
    issue_cash_receipt: "Issue Cash Receipt",
    cash_collected_success: "Cash payment logged successfully! Digital receipt generated.",
    slip_approved_success: "Slip approved and dues reconciled via FIFO.",
    
    offline_alert: "You are currently offline. Financial mutations are paused until connection is restored."
  },
  si: {
    app_title: "MRIA සුබසාධක කළමනාකරණ සංගමය",
    app_subtitle: "නිල සාමාජික ද්වාරය සහ මූල්‍ය ලෙජරය",
    sign_in_google: "Google මඟින් පිවිසෙන්න",
    signing_in: "පිවිසෙමින් පවතී...",
    sign_out: "පිටවන්න",
    welcome: "ආයුබෝවන්",
    role_admin: "පරිපාලක (Admin)",
    role_manager: "කළමනාකරු (Manager)",
    role_official: "නිලධාරී (Official)",
    role_treasurer: "භාණ්ඩාගාරික (Treasurer)",
    role_member: "සාමාජික (Member)",
    
    // Dashboard Stats
    outstanding_dues: "ගෙවීමට ඇති හිඟ මුදල්",
    current_month_status: "මෙම මස දායක මුදල් තත්ත්වය",
    total_benefits_claimed: "ලබාගත් මුළු ප්‍රතිලාභ",
    paid: "ගෙවා ඇත",
    pending: "ගෙවීමට ඇත",
    overdue: "පසුගිය හිඟ මුදල්",
    settled: "පියවා ඇත",
    due_rule_warning: "මාසික දායක මුදල් සෑම මසකම 31 දිනට පෙර ගෙවිය යුතුය.",
    
    // Actions
    upload_slip: "බැංකු රිසිට්පත යොමු කරන්න",
    apply_benefit: "සුබසාධන ආධාර අයදුම් කරන්න",
    view_receipt: "ඩිජිටල් රිසිට්පත",
    contact_admin: "පරිපාලක අමතන්න",
    
    // Bank QR
    bank_qr_title: "බැංකු ගෙවීම් QR කේතය",
    bank_name: "ලංකා බැංකුව",
    branch: "මත්තල ශාඛාව",
    acc_name: "MRIA සුබසාධක කළමනාකරණ සංගමය",
    acc_number: "ගිණුම් අංකය",
    
    // Ledger & Tables
    dues_history: "මාසික දායක මුදල් වාර්තාව",
    billing_month: "අදාළ මාසය",
    amount: "මුදල (රු.)",
    status: "තත්ත්වය",
    date: "දිනය",
    actions: "ක්‍රියාමාර්ග",
    no_records: "වාර්තා කිසිවක් හමු නොවීය.",
    
    // Payment History
    payment_history: "ගෙවීම් සහ රිසිට්පත් ඉතිහාසය",
    payment_type: "ගෙවීම් වර්ගය",
    payment_method: "ගෙවූ ක්‍රමය",
    category_monthly_due: "මාසික දායක මුදල",
    category_admission_fee: "ඇතුල්වීමේ ගාස්තුව",
    category_donation: "ආධාර / පරිත්‍යාග",
    status_pending_approval: "අනුමැතිය අපේක්ෂාවෙන්",
    status_verified: "තහවුරු කර ඇත",
    status_rejected: "ප්‍රතික්ෂේප විය",
    
    // Modals
    upload_slip_modal_title: "බැංකු ගෙවීම් රිසිට්පත යොමු කිරීම",
    select_category: "ගෙවීම් කාණ්ඩය තෝරන්න",
    enter_amount: "ගෙවූ මුදල (රු.)",
    drop_file_here: "බැංකු රිසිට්පත මෙතැනට දමන්න (JPEG, PNG හෝ PDF උපරිම 5MB)",
    choose_file: "ගොනුව තෝරන්න",
    submit_slip: "රිසිට්පත ඉදිරිපත් කරන්න",
    submitting: "ඉදිරිපත් වෙමින් පවතී...",
    
    claim_modal_title: "සුබසාධන ආධාර අයදුම්පත (මරණාධාර)",
    select_benefit_type: "ප්‍රතිලාභ වර්ගය",
    claim_amount: "අයදුම් කරන මුදල (රු.)",
    claim_notes: "විස්තරය / කරුණු",
    submit_claim: "අයදුම්පත ඉදිරිපත් කරන්න",
    
    // Unauthorized screen
    unauthorized_title: "ප්‍රවේශය සීමා කර ඇත",
    unauthorized_msg: "ඔබ තවමත් MRIA සුබසාධක සංගමයේ ලියාපදිංචි වී නොමැත. කරුණාකර පරිපාලක අමතන්න.",
    contact_whatsapp_btn: "WhatsApp මඟින් සම්බන්ධ වන්න: 0759555924",
    call_phone_btn: "පරිපාලක අමතන්න: 0759555924",
    
    // Admin Console
    admin_console: "කළමනාකරණ පුවරුව",
    tab_slips: "රිසිට්පත් අනුමත කිරීම",
    tab_cash: "අතින් ලැබුණු මුදල් එකතු කිරීම",
    tab_defaulters: "හිඟ මුදල් ලේඛනය (31 නීතිය)",
    tab_members: "සාමාජික කළමනාකරණය හා භූමිකා",
    tab_settings: "පද්ධති සැකසුම් හා බැංකු QR",
    tab_claims: "සුබසාධන ප්‍රතිලාභ අයදුම්පත්",
    
    approve_slip: "අනුමත කර හිඟ මුදල් පියවන්න (FIFO)",
    reject_slip: "ප්‍රතික්ෂේප කරන්න",
    issue_cash_receipt: "මුදල් රිසිට්පත නිකුත් කරන්න",
    cash_collected_success: "මුදල් ගෙවීම සාර්ථකව සටහන් විය! ඩිජිටල් රිසිට්පත නිකුත් කෙරිණි.",
    slip_approved_success: "රිසිට්පත අනුමත විය; දායක මුදල් FIFO ක්‍රමයට පියවිණි.",
    
    offline_alert: "ඔබ දැනට අන්තර්ජාලයෙන් විසන්ධි වී ඇත. මූල්‍ය ගනුදෙනු අත්හිටුවා ඇත."
  }
};

let currentLang = localStorage.getItem('mria_lang') || 'en';

export function getLanguage() {
  return currentLang;
}

export function t(key) {
  return translations[currentLang]?.[key] || translations['en']?.[key] || key;
}

export function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'si') return;
  currentLang = lang;
  localStorage.setItem('mria_lang', lang);
  applyTranslations();
  updateLangToggleButtons();
}

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key && translations[currentLang]?.[key]) {
      el.textContent = translations[currentLang][key];
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && translations[currentLang]?.[key]) {
      el.setAttribute('placeholder', translations[currentLang][key]);
    }
  });
}

export function updateLangToggleButtons() {
  document.querySelectorAll('.lang-toggle-btn').forEach((btn) => {
    if (currentLang === 'si') {
      btn.innerHTML = `
        <span class="material-symbols-outlined text-[18px] text-primary" data-icon="translate">translate</span>
        <span class="text-on-surface-variant text-caption">EN</span>
        <span class="text-outline">|</span>
        <span class="font-semibold text-primary sinhala-text">සිංහල</span>
      `;
    } else {
      btn.innerHTML = `
        <span class="material-symbols-outlined text-[18px] text-primary" data-icon="translate">translate</span>
        <span class="font-semibold text-primary">EN</span>
        <span class="text-outline">|</span>
        <span class="text-on-surface-variant sinhala-text text-caption">සිංහල</span>
      `;
    }
  });
}

export function toggleLanguage() {
  const newLang = currentLang === 'en' ? 'si' : 'en';
  setLanguage(newLang);
}

export function initLanguage() {
  document.querySelectorAll('.lang-toggle-btn, #langToggleBtn').forEach((btn) => {
    btn.classList.add('lang-toggle-btn');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleLanguage();
    });
  });
  updateLangToggleButtons();
  applyTranslations();
}

// Explicit Global Scope Bindings for inline HTML event handlers
if (typeof window !== "undefined") {
  window.toggleLanguage = toggleLanguage;
  window.setLanguage = setLanguage;
}


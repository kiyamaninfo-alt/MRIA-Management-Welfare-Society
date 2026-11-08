// Strict Single-Language i18n Engine (EN / SI)
// Zero mixed/dual-language UI. 100% English when EN is active, 100% Sinhala when SI is active.

export const translations = {
  en: {
    // Identity & Branding
    app_title: "MRIA Management Welfare Association",
    app_title_si: "MRIA කළමනාකාර සුබසාධක සංගමය",
    hero_tagline: "Digital Platform - MRIA Management Welfare Association",
    sub_headline: "100% DEDICATED STAFF WELFARE",
    app_subtitle: "Official Member Portal & Financial Ledger",
    footer_text: "© MRIA කළමනාකාර සුබසාධක සංගමය",

    // Auth & Navigation
    sign_in_google: "Sign in with Google",
    signing_in: "Signing in...",
    sign_out: "Sign Out",
    welcome: "Welcome",
    my_dashboard: "My Dashboard",
    admin_console: "Management Console",

    // Roles
    role_admin: "Administrator",
    role_manager: "Manager",
    role_secretary: "Secretary (ලේකම්)",
    role_treasurer: "Treasurer (භාණ්ඩාගාරික)",
    role_committee_member: "Committee Member",
    role_member: "Member",

    // Member Identity Header
    member_epf: "EPF No",
    member_designation: "Designation",
    member_status: "Membership Status",
    status_active: "Active Member",
    status_pending: "Approval Pending",

    // Dashboard Cards & Stats
    outstanding_dues: "Outstanding Dues",
    current_month_status: "Current Month Due",
    total_benefits_claimed: "Total Welfare Claimed",
    last_payment: "Last Payment",
    last_claim: "Last Claimed",
    click_for_history: "Click to inspect monthly dues ledger",
    no_outstanding_dues: "All dues settled. Thank you!",
    paid: "Paid",
    pending: "Pending",
    overdue: "Overdue",
    settled: "Settled",
    due_rule_warning: "Monthly dues must be settled on or before the 31st of each month.",

    // Dashboard Notification Center
    notifications_center: "Recent Notifications",
    dismiss: "Dismiss",
    no_notifications: "No new notifications.",
    alert_dues_overdue: "You have overdue monthly contributions. Please settle promptly.",
    alert_claim_reviewed: "Your benefit claim status has been updated.",
    alert_general_meeting: "Upcoming Association General Meeting notice published.",

    // Actions & Buttons
    upload_slip: "Upload Bank Slip",
    apply_benefit: "Apply for Welfare Benefit",
    view_receipt: "Digital Receipt",
    download_voucher: "Download PDF Voucher",
    contact_admin: "Contact Administration",
    download_constitution: "Download Constitution (PDF)",
    view_policy: "Privacy Policy",
    view_terms: "Security Terms",

    // Bank Details & Transfer
    bank_details_title: "Official Bank of Ceylon Account",
    bank_name: "Bank of Ceylon",
    bank_branch: "Mattala Branch",
    acc_name: "MRIA Management Welfare Association",
    acc_number: "Account No",
    bank_qr_title: "Scan & Pay via BOC QR",

    // Dues History & Ledger Popup
    dues_history: "Monthly Dues History",
    dues_breakdown_title: "Monthly Contributions Breakdown",
    billing_month: "Billing Month",
    amount: "Amount (LKR)",
    status: "Status",
    date: "Date",
    actions: "Actions",
    no_records: "No records found.",
    close: "Close",

    // Payment History & Slips
    payment_history: "Payment & Slip Submissions",
    payment_type: "Payment Type",
    payment_method: "Payment Method",
    category_monthly_due: "Monthly Due",
    category_admission_fee: "Admission Fee",
    category_donation: "Donation",
    method_bank_transfer: "Bank Transfer",
    method_cash: "Direct Cash",
    status_pending_approval: "Pending Approval",
    status_verified: "Verified",
    status_rejected: "Rejected",

    // Upload Slip Modal
    upload_slip_modal_title: "Upload Bank Payment Slip",
    select_category: "Select Payment Category",
    enter_amount: "Payment Amount (LKR)",
    drop_file_here: "Drag and drop bank slip (JPEG, PNG, or PDF max 5MB)",
    choose_file: "Choose File",
    take_photo_btn: "Open Camera",
    browse_file_btn: "Choose File",
    slip_file_label: "Bank Slip File (JPEG, PNG, or PDF max 5MB)",
    submit_slip: "Submit Payment Slip",
    submitting: "Submitting...",

    // Welfare Claim Modal
    claim_modal_title: "Apply for Welfare Benefit",
    select_benefit_type: "Benefit Type",
    claim_amount: "Claim Amount (LKR)",
    claim_notes: "Description / Notes",
    submit_claim: "Submit Application",
    claim_submitted_success: "Benefit claim submitted successfully. Committee officials notified.",

    // Contact Admin Modal
    contact_modal_title: "Contact Administration",
    contact_recipient_info: "Inquiries are directed to the Welfare Administration (krishaja@gmail.com).",
    contact_subject: "Subject",
    contact_message: "Message",
    send_inquiry: "Send Inquiry",
    inquiry_sent: "Inquiry sent to welfare administration.",

    // Unauthorized & Self-Registration
    unauthorized_title: "Membership Registration Required",
    unauthorized_msg: "You have signed in with an unlisted Google account. Please submit your EPF Number and Designation to request membership approval from the Secretary.",
    register_request_btn: "Request Membership Access",
    register_modal_title: "Submit Membership Registration",
    epf_number_label: "EPF Number",
    epf_placeholder: "e.g., EPF-1024 or 10245",
    designation_label: "Designation / Position",
    designation_placeholder: "e.g., Airport Manager, Operations Officer",
    phone_label: "Mobile Phone Number",
    phone_placeholder: "e.g., 0712345678",
    submit_registration: "Submit Application",
    registration_submitted: "Your registration request has been submitted to the Secretary. You will gain access once verified.",

    // Admin & Staff Navigation Tabs
    tab_slips: "Slip Approvals",
    tab_cash: "Cash Collection",
    tab_treasury: "Society Treasury",
    tab_secretary: "Member Profiles",
    tab_claims: "Benefit Grants",
    tab_defaulters: "Defaulters (31st)",
    tab_cms: "Content & Settings",
    bank_settings_title: "Official Bank Coordinates & LankaQR",
    bank_settings_desc: "Configure the official association bank account and LankaQR payment code shown on member dashboards.",
    upload_qr: "Upload New QR",
    reset_qr: "Reset Default",
    save_bank_details: "Save Bank Coordinates",
    bank_settings_saved: "Bank coordinates & QR code saved successfully!",

    // Treasury Module
    treasury_title: "Society Treasury & Financial Ledger",
    treasury_account_savings: "BOC Savings Account",
    treasury_account_cash: "Cash in Hand",
    treasury_account_fd: "Fixed Deposits",
    treasury_total_funds: "Total Liquid Funds",
    record_transaction: "Record Treasury Transaction",
    statement_generator: "Statement Generator & Export",
    statement_monthly: "Monthly Statement",
    statement_yearly: "Yearly Statement",
    statement_custom: "Custom Date Range",
    export_csv: "Export CSV (RFC 4180)",
    print_pdf: "Print / Save PDF",
    opening_balance: "Opening Balance",
    closing_balance: "Closing Balance",
    period_inflows: "Total Inflows",
    period_outflows: "Total Outflows",

    // Secretary Module
    secretary_title: "Member Directory & Records Management",
    add_new_member: "Add Pre-Registered Member",
    edit_member_profile: "Edit Member Profile",
    save_changes: "Save Changes",
    full_name: "Full Name",
    email_address: "Email Address",

    // Voucher Copy
    voucher_desc: "Instant downloadable PDF vouchers with official verification seals for every contribution and emergency grant transaction.",

    offline_alert: "You are currently offline. Financial mutations are paused until connection is restored."
  },

  si: {
    // Identity & Branding
    app_title: "MRIA කළමනාකාර සුබසාධක සංගමය",
    app_title_si: "MRIA කළමනාකාර සුබසාධක සංගමය",
    hero_tagline: "ඩිජිටල් වේදිකාව - MRIA කළමනාකාර සුබසාධක සංගමය",
    sub_headline: "100% කාර්ය මණ්ඩල සුබසාධනය උදෙසා",
    app_subtitle: "නිල සාමාජික ද්වාරය සහ මූල්‍ය ලෙජරය",
    footer_text: "© MRIA කළමනාකාර සුබසාධක සංගමය",

    // Auth & Navigation
    sign_in_google: "Google මඟින් පිවිසෙන්න",
    signing_in: "පිවිසෙමින් පවතී...",
    sign_out: "පිටවන්න",
    welcome: "ආයුබෝවන්",
    my_dashboard: "මගේ පුවරුව",
    admin_console: "කළමනාකරණ පුවරුව",

    // Roles
    role_admin: "පරිපාලක",
    role_manager: "කළමනාකරු",
    role_secretary: "ලේකම්",
    role_treasurer: "භාණ්ඩාගාරික",
    role_committee_member: "කාරක සභික",
    role_member: "සාමාජික",

    // Member Identity Header
    member_epf: "සේ.අ.අංකය (EPF)",
    member_designation: "තනතුර",
    member_status: "සාමාජික තත්ත්වය",
    status_active: "ක්‍රියාකාරී සාමාජික",
    status_pending: "අනුමැතිය අපේක්ෂාවෙන්",

    // Dashboard Cards & Stats
    outstanding_dues: "ගෙවීමට ඇති හිඟ මුදල්",
    current_month_status: "මෙම මස දායක මුදල",
    total_benefits_claimed: "ලබාගත් සුබසාධන ආධාර",
    last_payment: "අවසන් ගෙවීම",
    last_claim: "අවසන් ආධාරය",
    click_for_history: "මාසික දායක මුදල් ලේඛනය පරීක්ෂා කිරීමට ඔබන්න",
    no_outstanding_dues: "සියලුම දායක මුදල් ගෙවා ඇත. ස්තූතියි!",
    paid: "ගෙවා ඇත",
    pending: "ගෙවීමට ඇත",
    overdue: "පසුගිය හිඟ මුදල්",
    settled: "පියවා ඇත",
    due_rule_warning: "මාසික දායක මුදල් සෑම මසකම 31 දිනට පෙර ගෙවිය යුතුය.",

    // Dashboard Notification Center
    notifications_center: "මෑත නිවේදන සහ දැනුම්දීම්",
    dismiss: "ඉවත් කරන්න",
    no_notifications: "නව දැනුම්දීම් නොමැත.",
    alert_dues_overdue: "ඔබගේ පසුගිය මාසික දායක මුදල් ගෙවීමට ඇත. කරුණාකර කඩිනමින් පියවන්න.",
    alert_claim_reviewed: "ඔබගේ සුබසාධන ආධාර අයදුම්පතේ තත්ත්වය යාවත්කාලීන කර ඇත.",
    alert_general_meeting: "සංගමයේ ඉදිරි මහා සභා රැස්වීම පිළිබඳ නිවේදනය පළ කර ඇත.",

    // Actions & Buttons
    upload_slip: "බැංකු රිසිට්පත යොමු කරන්න",
    apply_benefit: "සුබසාධන ආධාර අයදුම් කරන්න",
    view_receipt: "ඩිජිටල් රිසිට්පත",
    download_voucher: "PDF රිසිට්පත භාගත කරන්න",
    contact_admin: "පරිපාලක අමතන්න",
    download_constitution: "ව්‍යවස්ථාව භාගත කරන්න (PDF)",
    view_policy: "පෞද්ගලිකත්ව ප්‍රතිපත්තිය",
    view_terms: "ආරක්ෂක කොන්දේසි",

    // Bank Details & Transfer
    bank_details_title: "නිල ලංකා බැංකු ගිණුම් විස්තර",
    bank_name: "ලංකා බැංකුව (BOC)",
    bank_branch: "මත්තල ශාඛාව",
    acc_name: "MRIA කළමනාකාර සුබසාධක සංගමය",
    acc_number: "ගිණුම් අංකය",
    bank_qr_title: "BOC QR මඟින් පහසුවෙන් ගෙවන්න",

    // Dues History & Ledger Popup
    dues_history: "මාසික දායක මුදල් වාර්තාව",
    dues_breakdown_title: "මාසික දායක මුදල් විස්තරාත්මක ලේඛනය",
    billing_month: "අදාළ මාසය",
    amount: "මුදල (රු.)",
    status: "තත්ත්වය",
    date: "දිනය",
    actions: "ක්‍රියාමාර්ග",
    no_records: "වාර්තා කිසිවක් හමු නොවීය.",
    close: "වසන්න",

    // Payment History & Slips
    payment_history: "ගෙවීම් සහ රිසිට්පත් ඉතිහාසය",
    payment_type: "ගෙවීම් වර්ගය",
    payment_method: "ගෙවූ ක්‍රමය",
    category_monthly_due: "මාසික දායක මුදල",
    category_admission_fee: "ඇතුල්වීමේ ගාස්තුව",
    category_donation: "ආධාර / පරිත්‍යාග",
    method_bank_transfer: "බැංකු තැන්පතු",
    method_cash: "අතින් දුන් මුදල්",
    status_pending_approval: "අනුමැතිය අපේක්ෂාවෙන්",
    status_verified: "තහවුරු කර ඇත",
    status_rejected: "ප්‍රතික්ෂේප විය",

    // Upload Slip Modal
    upload_slip_modal_title: "බැංකු ගෙවීම් රිසිට්පත යොමු කිරීම",
    select_category: "ගෙවීම් කාණ්ඩය තෝරන්න",
    enter_amount: "ගෙවූ මුදල (රු.)",
    drop_file_here: "කැමරාවෙන් ඡායාරූපයක් ගන්න හෝ ගොනුවක් තෝරන්න (උපරිම 5MB)",
    choose_file: "ගොනුව තෝරන්න",
    take_photo_btn: "කැමරාව විවෘත කරන්න",
    browse_file_btn: "ගොනුවක් තෝරන්න",
    slip_file_label: "බැංකු රිසිට්පත් ඡායාරූපය හෝ PDF ගොනුව (උපරිම 5MB)",
    submit_slip: "රිසිට්පත ඉදිරිපත් කරන්න",
    submitting: "ඉදිරිපත් වෙමින් පවතී...",

    // Welfare Claim Modal
    claim_modal_title: "සුබසාධන ආධාර අයදුම්පත",
    select_benefit_type: "ප්‍රතිලාභ වර්ගය",
    claim_amount: "අයදුම් කරන මුදල (රු.)",
    claim_notes: "විස්තරය / කරුණු",
    submit_claim: "අයදුම්පත ඉදිරිපත් කරන්න",
    claim_submitted_success: "සුබසාධන ආධාර අයදුම්පත සාර්ථකව ඉදිරිපත් කරන ලදී. නිලධාරීන් වෙත දැනුම් දෙන ලදී.",

    // Contact Admin Modal
    contact_modal_title: "පරිපාලක අමතන්න",
    contact_recipient_info: "ඔබගේ විමසීම් සුබසාධක සංගමයේ පරිපාලනය වෙත යොමු කෙරේ (krishaja@gmail.com).",
    contact_subject: "විෂය",
    contact_message: "පණිවිඩය",
    send_inquiry: "විමසීම යොමු කරන්න",
    inquiry_sent: "විමසීම සාර්ථකව යොමු කරන ලදී.",

    // Unauthorized & Self-Registration
    unauthorized_title: "සාමාජික ලියාපදිංචිය අවශ්‍යයි",
    unauthorized_msg: "ඔබ ලැයිස්තුගත නොවූ Google ගිණුමකින් පිවිස ඇත. ලේකම්වරයාගේ අනුමැතිය ලබාගැනීම සඳහා කරුණාකර ඔබගේ සේ.අ.අංකය (EPF) සහ තනතුර ඇතුළත් කර අයදුම් කරන්න.",
    register_request_btn: "සාමාජිකත්වය ඉල්ලා සිටින්න",
    register_modal_title: "සාමාජික ලියාපදිංචි අයදුම්පත",
    epf_number_label: "සේවා නියුක්තිකයන්ගේ අර්ථසාධක අංකය (EPF)",
    epf_placeholder: "උදා: 10245 හෝ EPF-1024",
    designation_label: "තනතුර",
    designation_placeholder: "උදා: ගුවන්තොටුපළ කළමනාකරු, මෙහෙයුම් නිලධාරී",
    phone_label: "ජංගම දුරකථන අංකය",
    phone_placeholder: "උදා: 0712345678",
    submit_registration: "ලියාපදිංචි අයදුම්පත යොමු කරන්න",
    registration_submitted: "ඔබගේ ලියාපදිංචි අයදුම්පත ලේකම්වරයා වෙත යොමු කරන ලදී. තහවුරු කළ පසු ඔබට ප්‍රවේශය ලැබෙනු ඇත.",

    // Admin & Staff Navigation Tabs
    tab_slips: "රිසිට්පත් අනුමැතිය",
    tab_cash: "මුදල් එකතු කිරීම",
    tab_treasury: "මහජන භාණ්ඩාගාරය",
    tab_secretary: "සාමාජික තොරතුරු",
    tab_claims: "සුබසාධන ආධාර",
    tab_defaulters: "හිඟ මුදල් ලේඛනය (31 නීතිය)",
    tab_cms: "අන්තර්ගතය සහ සැකසුම්",
    bank_settings_title: "නිල බැංකු තොරතුරු සහ LankaQR කේතය",
    bank_settings_desc: "සාමාජිකයින්ට මුදල් තැන්පත් කිරීම සඳහා පෙන්වන නිල බැංකු ගිණුම් විස්තර සහ LankaQR කේතය මෙතැනින් සංස්කරණය කරන්න.",
    upload_qr: "නව QR එක් කරන්න",
    reset_qr: "මුල් QR යොදන්න",
    save_bank_details: "බැංකු තොරතුරු සුරකින්න",
    bank_settings_saved: "බැංකු විස්තර සහ QR කේතය සාර්ථකව සුරකින ලදී!",

    // Treasury Module
    treasury_title: "සංගමයේ භාණ්ඩාගාරය සහ මූල්‍ය ලෙජරය",
    treasury_account_savings: "ලංකා බැංකු ඉතුරුම් ගිණුම",
    treasury_account_cash: "අතැති මුදල්",
    treasury_account_fd: "ස්ථාවර තැන්පතු",
    treasury_total_funds: "මුළු ද්‍රවශීල අරමුදල",
    record_transaction: "භාණ්ඩාගාර ගනුදෙනුවක් සටහන් කරන්න",
    statement_generator: "මූල්‍ය ප්‍රකාශන හා වාර්තා",
    statement_monthly: "මාසික ප්‍රකාශනය",
    statement_yearly: "වාර්ෂික ප්‍රකාශනය",
    statement_custom: "තෝරාගත් කාලසීමාව",
    export_csv: "CSV ගොනුවක් ලෙස භාගත කරන්න",
    print_pdf: "මුද්‍රණය / PDF ලෙස සුරකින්න",
    opening_balance: "ආරම්භක ශේෂය",
    closing_balance: "අවසාන ශේෂය",
    period_inflows: "මුළු ලැබීම්",
    period_outflows: "මුළු ගෙවීම්",

    // Secretary Module
    secretary_title: "සාමාජික නාමාවලිය සහ ලේඛන කළමනාකරණය",
    add_new_member: "නව සාමාජිකයෙකු ලියාපදිංචි කරන්න",
    edit_member_profile: "සාමාජික තොරතුරු සංස්කරණය",
    save_changes: "වෙනස්කම් සුරකින්න",
    full_name: "සම්පූර්ණ නම",
    email_address: "විද්‍යුත් තැපෑල",

    // Voucher Copy
    voucher_desc: "සෑම දායක මුදලක් සහ හදිසි ප්‍රදානයක් සඳහාම නිල තහවුරු කිරීමේ මුද්‍රාව සහිත ක්ෂණික බාගත කළ හැකි PDF වවුචර.",

    offline_alert: "ඔබ දැනට අන්තර්ජාලයෙන් විසන්ධි වී ඇත. මූල්‍ය ගනුදෙනු අත්හිටුවා ඇත."
  }
};

let currentLang = localStorage.getItem("mria_lang") || "si";

export function getLanguage() {
  return currentLang;
}

export function t(key) {
  return translations[currentLang]?.[key] || translations["en"]?.[key] || key;
}

export function setLanguage(lang) {
  if (lang !== "en" && lang !== "si") return;
  currentLang = lang;
  localStorage.setItem("mria_lang", lang);
  
  // Apply language typography class on body
  if (document.body) {
    if (lang === "si") {
      document.body.classList.add("lang-si");
    } else {
      document.body.classList.remove("lang-si");
    }
  }

  applyTranslations();
  updateLangToggleButtons();
}

export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && translations[currentLang]?.[key]) {
      el.textContent = translations[currentLang][key];
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key && translations[currentLang]?.[key]) {
      el.setAttribute("placeholder", translations[currentLang][key]);
    }
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key && translations[currentLang]?.[key]) {
      el.setAttribute("title", translations[currentLang][key]);
    }
  });
}

export function updateLangToggleButtons() {
  document.querySelectorAll(".lang-toggle-btn").forEach((btn) => {
    if (currentLang === "si") {
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
  const newLang = currentLang === "en" ? "si" : "en";
  setLanguage(newLang);
}

export function initLanguage() {
  document.querySelectorAll(".lang-toggle-btn, #langToggleBtn").forEach((btn) => {
    btn.classList.add("lang-toggle-btn");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleLanguage();
    });
  });

  // Set initial typography class on body
  if (document.body) {
    if (currentLang === "si") {
      document.body.classList.add("lang-si");
    } else {
      document.body.classList.remove("lang-si");
    }
  }

  updateLangToggleButtons();
  applyTranslations();
}

// Explicit Global Scope Bindings for inline HTML event handlers
if (typeof window !== "undefined") {
  window.toggleLanguage = toggleLanguage;
  window.setLanguage = setLanguage;
  window.t = t;
}

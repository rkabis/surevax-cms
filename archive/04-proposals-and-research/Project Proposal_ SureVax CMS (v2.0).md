# **Project Proposal: SureVax Clinic Management System (CMS) v2.0**

**Project Goal:** Transition from the current AppSheet prototype to a scalable, custom-developed web application (React/Node/PostgreSQL) to resolve performance bottlenecks, ensure data integrity, and replicate existing clinical workflows with higher efficiency.

## **1\. Problem Statement**

The clinic is currently operating on a Minimum Viable Product (MVP) built on AppSheet and Google Sheets. The architecture has reached its technical ceiling and is limiting operations:

- **Database Latency & Instability:** Google Sheets is acting as a database but lacks relational integrity. As patient records grow, read/write speeds degrade, causing lag during intake and increasing the risk of data sync errors.
- **Usability Debt:** The generic interface forces inefficient workflows (e.g., deep menu navigation), increasing the time required to process each patient.
- **Unoptimized for Scale:** Critical logic runs on spreadsheet formulas rather than server-side code, making the system brittle as the clinic expands to new branches.

---

## **2\. Project Scope: Functional Replication (MVP)**

The objective of the MVP is the strict replication of current capabilities into a stable environment. The system will be built around the following modules:

### **A. Patient Data Management**

- **Master Patient Index:** A searchable, central repository for all patient demographics (Name, Contact, Address).
- **Pet Status Tracking:** Dedicated fields to track the biting animal's status (Alive, Dead, Unknown) and observation dates, which directly influence the vaccination protocol.
- **Medical History Dashboard:** A consolidated view for each patient showing their entire lineage of immunizations, related transactions, and file attachments (e.g., photos of wounds or previous records).

### **B. Clinical Intake & Immunization Modules**

- **Single Immunization Intake:** A module for logging individual, ad-hoc vaccines or services (e.g., a single Tetanus Toxoid booster or a specific Rabies dose). This creates a single record in the Immunization table with details on Vaccine Brand, Route (ID/IM), and Site (e.g., Left Deltoid).
- **Immunization Bundle Intake:** A high-efficiency "Macro" module for standard Day 0 cases. This allows the nurse to input one set of data (e.g., "New Dog Bite Patient") which the system then "explodes" into multiple distinct records:
  - 1 Consultation Record
  - 1 ARV Dose 1 Record
  - 1 Tetanus Toxoid Record
  - 1 ERIG Record (if applicable)
- **Auto-Creation of Future Appointments:**
  - Upon the creation of a Day 0 dose, the system must automatically generate "Pending" records for the required succeeding doses (Day 3, 7, 14, 28\) based on standard PEP/PrEP intervals.
  - These records must populate the "Future Appointments" view to serve as a tickler file for daily operations.
  - The system must track the "Ideal Date" (Protocol) vs. "Actual Date" (Administered).

### **C. Financial & Transaction Modules**

- **Transaction Logging:** A dedicated module to record financial exchanges. It must be capable of linking one financial transaction to multiple medical services (e.g., One payment covering Consult \+ 3 Shots).
- **Split Payment Processing:** Explicit support for recording revenue across multiple payment channels within a single transaction record:
  - Cash
  - Digital Wallets (GCash, Maya)
  - Payment Gateways (PayMongo)
  - Direct Bank Transfers
- **Revenue Adjustments:** Ability to log discounts or adjustments separate from the gross service value.
- **Acknowledgement Receipt Printing**: Integrated printing of acknowledgement receipts.

### **D. Operations & Reporting Modules**

- **Nurse Shift Management:** A digital time-clock module allowing staff to log "Time In" and "Time Out" at their specific branch, creating a log for payroll and workforce auditing.
- **Branch Reporting:** Automated "End of Day" generation. The system must aggregate data from the Transaction and Immunization tables to produce a report summarizing:
  - Total Services Rendered
  - Total Collections (broken down by Cash vs. Digital)
  - Total Adjustments/Discounts
  - Net Revenue

### **E. Security & Access Control**

- **Branch Isolation (Multi-Tenancy):** Strict Role-Based Access Control (RBAC). Staff assigned to "Branch A" must be technically restricted from querying, viewing, or editing data from "Branch B."
- **Super-Admin Access:** A high-level permission tier allowing management to view aggregated data across all branches.

---

## **3\. Technical Strategy**

- **Frontend:** **React.js** – To provide a responsive, "app-like" experience on desktop and phones, specifically enabling split-screen views (List/Detail) to reduce navigation clicks.
- **Backend:** **Node.js** or **Python** – To handle the server-side logic for "bundling" entries and calculating appointment dates.
- **Database:** **PostgreSQL** – To replace Google Sheets, ensuring sub-second query times, data integrity, and scalable storage.

---

## **4\. Deliverables Strategy**

To manage risk, the project will be delivered in phases:

1. **Phase 1 (The Core):** Secure Database, Patient Management, Single & Bundle Immunization Intake, Transaction Logging.
2. **Phase 2 (Automation):** Auto-creation of future appointments logic, Nurse Shift logging, Branch Report generation, Acknowledgement Receipt Printing.
3. **Phase 3 (Migration):** Import of legacy data from Google Sheets to the new SQL database.

## ---

**5\. Future Opportunities (Strategic Roadmap)**

### **Vertical Growth (Deepening Value per Patient)**

- **CRM & Automated Patient Engagement:**
  - _Smart "Recall" Engine:_ Integration with SMS gateways (e.g., Twilio, Semaphore) to automatically send reminders for upcoming doses without nurse intervention.
  - _Lifecycle Marketing:_ Automated campaigns for long-term health, such as annual Tetanus booster reminders or "Pet Health Check" prompts 12 months after a bite incident.
- **Patient Self-Service Portal:**
  - _Digital Health Card:_ A secure, mobile-friendly web view where patients can access their vaccination history and digital certificates via a personal QR code.
  - _Self-Scheduling:_ Allowing patients to confirm or request a reschedule of their follow-up appointments directly through the portal, updating the "Future Appointments" view in real-time.
- **Inventory Intelligence:**
  - _Real-Time Deduction:_ Logic that automatically subtracts specific dosages (e.g., 0.5 mL) from specific vial batches (e.g., Batch \#A123) the moment a "Bundle" is submitted.
  - _Expiration Management:_ Automated "First-Expired-First-Out" (FEFO) alerts to prevent wastage of vaccines nearing their expiry date.
- **Advanced Operational Dashboards:**
  - _Live Command Center:_ A real-time executive view showing patient volume, wait times, and revenue velocity across all branches instantly.
  - _Compliance Heatmaps:_ Analytics identifying specific branches or staff members with higher-than-average "Lost to Follow-up" rates to target training interventions.

### **Horizontal Growth (Software Capabilities & Operational Scope)**

- **Multi-Tenant SaaS Architecture:**
  - The "Branch Isolation" logic can be scaled into full **Multi-Tenancy**, allowing the software to host entirely different clinic owners (franchisees or external clients) on the same infrastructure with guaranteed data sovereignty. This effectively turns the internal tool into a marketable SaaS product.
- **Offline-First Capability:**
  - Enhancing the React frontend with **Progressive Web App (PWA)** capabilities to allow full data entry and "Bundle" submission even when the internet is down. The software would locally cache transactions and automatically sync with the central database once connectivity is restored, ensuring business continuity in remote areas.
- **Tele-Triage & Pre-Assessment Modules:**
  - _Remote Intake:_ A public-facing module allowing patients to upload photos of their wounds and animal details _before_ arriving at the clinic. This facilitates "Pre-Triage" by the medical team, reducing in-clinic wait times and streamlining the "Consultation" phase.
- **Supply Chain Automation:**
  - Expanding the software's scope from simple inventory tracking to **Vendor Management**. The system could automatically generate Purchase Orders (POs) or reorder alerts when vaccine stock levels dip below a defined "Par Level" based on historical consumption rates.

---

## **6\. Project Costing & Financial Estimates**

### **A. One-Time Investment (Development Phase)**

| Item                              | Cost (PHP)      | Notes                                                                                              |
| :-------------------------------- | :-------------- | :------------------------------------------------------------------------------------------------- |
| **Custom CMS Base Package (MVP)** | **₱120,000.00** | Covers Phase 1 (Core) & Phase 2 (Automation) deliverables.                                         |
| **Migration & Setup**             | _Included_      | Migration of legacy AppSheet/GSheet data to SQL.                                                   |
| **Total One-Time Cost**           | **₱120,000.00** | Negotiable; can lower upfront cost if monthly retainer can be renegotiated beyond 9k php per month |

The **₱120,000** base package fee represents a specialized "Internal Build Rate" for the transition from a prototype to a professional-grade software asset. This fee covers:

- **Architecture Re-platforming:** Moving the entire business logic from fragile spreadsheet formulas to a secure, server-side environment (Node.js/Python).
- **Database Engineering:** Designing and deploying a dedicated PostgreSQL relational database to solve the current latency and sync issues.
- **Security Implementation:** Building a custom Role-Based Access Control (RBAC) system to strictly isolate branch data, ensuring compliance with data privacy standards.
- **Custom UI Development:** Engineering a React-based frontend specifically designed for high-speed clinical intake (e.g., the "Split-Screen" and "Bundle" interfaces), which standard ERPs/CMSs do not offer (modeled after our current AR generator but optimized based on nurse feedback).

### **B. Monthly Recurring Costs (Operating Expenses)**

Once live, the system requires cloud infrastructure. We recommend a "Managed Database" setup to ensure patient data is automatically backed up every day without manual intervention.

| Item                       | Estimated Cost (PHP)   | Breakdown & Justification                                                                                                                                                             |
| :------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **App Server (Compute)**   | **₱350 \- ₱400**       | **1x Basic VPS (e.g., DigitalOcean Droplet \- $6/mo).** This hosts the React frontend and Node.js backend. 1GB RAM / 1 CPU is sufficient for current clinic volume.                   |
| **Managed Database**       | **₱900 \- ₱1,000**     | **1x Managed PostgreSQL (e.g., DigitalOcean \- $15/mo).** *H*andles daily backups, security updates, and crash recovery automatically. This protects the clinic from data corruption. |
| **Object Storage (Files)** | **₱250 \- ₱300**       | **AWS S3 or DigitalOcean Spaces ($5/mo).** For storing patient file attachments (e.g., photos of bite wounds, scanned IDs) separate from the database to keep the app fast.           |
| **Total Monthly OPEX**     | **\~₱1,600 \- ₱1,800** | _Fluctuates slightly based on USD-PHP exchange rate._                                                                                                                                 |

**Software Maintenance & Assurance:** **₱0.00 (Included/Waived)** To ensure long-term operational stability without unpredictable costs, this proposal adopts a "Zero-Additional-Cost" maintenance model. Unlike external agencies that charge hourly fees for support, all routine post-launch maintenance, including priority bug fixes, security patches, and server health monitoring, is fully covered under my existing Developer Retainer. This structure guarantees that the clinic incurs **zero extra expense** for standard software upkeep, providing enterprise-grade peace of mind that the system will remain secure and bug-free for the duration of our engagement.

<script>

/* =====================================================
   LUMIO — JAVASCRIPT COMPLET
   FREE → PAIEMENT → CONFIRMATION → PREMIUM
===================================================== */


/* =====================================================
   CONFIGURATION
===================================================== */

const API_URL =
"https://lumio-backend-1-i6a3.onrender.com";

const TCHOTCHOM_PAYMENT_URL =
"https://tchotchom.com/dDL1O43u09V40aYmtcVHrzsekuUletIY8vmKYicZ5KU";

const PREMIUM_PRICE = 250;


/* =====================================================
   VARIABLES
===================================================== */

let token =
localStorage.getItem("lumio_token") || "";

let currentUser = null;

let tasksData = [];
let eventsData = [];
let notesData = [];
let budgetData = [];
let goalsData = [];

let registerMode = true;

let isPremium = false;


/* =====================================================
   UTILITAIRES
===================================================== */

function escapeHTML(value){

  return String(value ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");

}


function showError(message){

  const box =
    document.getElementById("error");

  if(box){

    box.textContent =
      message || "";

  }

}


function formatMoney(value){

  return Number(value || 0)
    .toLocaleString("fr-FR",{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    }) + " HTG";

}


/* =====================================================
   API
===================================================== */

async function api(path,options={}){

  const headers = {

    "Content-Type":
      "application/json",

    ...(options.headers || {})

  };


  if(token){

    headers.Authorization =
      "Bearer " + token;

  }


  let response;


  try{

    response =
      await fetch(
        API_URL + path,
        {
          ...options,
          headers
        }
      );

  }catch(error){

    throw new Error(
      "Impossible de contacter le serveur Lumio."
    );

  }


  let data;


  try{

    data =
      await response.json();

  }catch{

    data = {

      success:false,

      error:
        "Réponse serveur invalide."

    };

  }


  if(response.status === 401){

    clearSession();

    showAuth();

    throw new Error(
      "Votre session a expiré. Connectez-vous à nouveau."
    );

  }


  if(!response.ok){

    throw new Error(

      data?.error ||

      data?.message ||

      "Erreur serveur."

    );

  }


  return data;

}


/* =====================================================
   SESSION
===================================================== */

function clearSession(){

  token = "";

  currentUser = null;

  isPremium = false;

  localStorage.removeItem(
    "lumio_token"
  );

}


function showAuth(){

  const app =
    document.getElementById("app");

  const auth =
    document.getElementById("auth");


  if(app){

    app.classList.add(
      "hidden"
    );

  }


  if(auth){

    auth.classList.remove(
      "hidden"
    );

  }

}


function showApplication(){

  const auth =
    document.getElementById("auth");

  const app =
    document.getElementById("app");


  if(auth){

    auth.classList.add(
      "hidden"
    );

  }


  if(app){

    app.classList.remove(
      "hidden"
    );

  }

}


/* =====================================================
   AUTHENTIFICATION
===================================================== */

const authForm =
  document.getElementById(
    "authForm"
  );

const authTitle =
  document.getElementById(
    "authTitle"
  );

const authSubmit =
  document.getElementById(
    "authSubmit"
  );

const switchMode =
  document.getElementById(
    "switchMode"
  );

const switchText =
  document.getElementById(
    "switchText"
  );


if(switchMode){

  switchMode.addEventListener(
    "click",
    function(){

      registerMode =
        !registerMode;

      showError("");


      if(registerMode){

        authTitle.textContent =
          "Bienvenue sur Lumio";

        authSubmit.textContent =
          "Créer mon compte";

        switchText.textContent =
          "Vous avez déjà un compte ?";

        switchMode.textContent =
          "Se connecter";

      }else{

        authTitle.textContent =
          "Bon retour sur Lumio";

        authSubmit.textContent =
          "Se connecter";

        switchText.textContent =
          "Vous n'avez pas encore de compte ?";

        switchMode.textContent =
          "Créer un compte";

      }

    }
  );

}


/* =====================================================
   FORMULAIRE AUTH
===================================================== */

if(authForm){

  authForm.addEventListener(
    "submit",
    async function(event){

      event.preventDefault();

      showError("");


      const email =
        document
          .getElementById("email")
          .value
          .trim()
          .toLowerCase();


      const password =
        document
          .getElementById("password")
          .value;


      if(!email || !password){

        showError(
          "Veuillez remplir tous les champs."
        );

        return;

      }


      if(password.length < 6){

        showError(
          "Le mot de passe doit contenir au moins 6 caractères."
        );

        return;

      }


      authSubmit.disabled =
        true;


      authSubmit.textContent =
        registerMode
          ? "Création..."
          : "Connexion...";


      try{

        const endpoint =
          registerMode
            ? "/api/auth/register"
            : "/api/auth/login";


        const data =
          await api(
            endpoint,
            {
              method:"POST",

              body:
                JSON.stringify({

                  email,

                  password

                })

            }
          );


        if(!data?.token){

          throw new Error(

            data?.error ||

            "Le serveur n'a pas envoyé de token."

          );

        }


        token =
          data.token;


        localStorage.setItem(
          "lumio_token",
          token
        );


        currentUser =
          data.user ||

          data.data?.user ||

          null;


        document
          .getElementById(
            "password"
          )
          .value = "";


        await openApp();


      }catch(error){

        console.error(
          "AUTH ERROR:",
          error
        );


        showError(
          error.message ||
          "Impossible de continuer."
        );


      }finally{

        authSubmit.disabled =
          false;


        authSubmit.textContent =
          registerMode
            ? "Créer mon compte"
            : "Se connecter";

      }

    }
  );

}


/* =====================================================
   OUVRIR APPLICATION
===================================================== */

async function openApp(){

  if(!token){

    showAuth();

    return;

  }


  showApplication();


  try{

    const me =
      await api(
        "/api/auth/me"
      );


    currentUser =
      me?.user ||

      me?.data?.user ||

      me?.data ||

      me ||

      currentUser;


  }catch(error){

    console.error(error);


    clearSession();

    showAuth();


    showError(
      "Session invalide. Veuillez vous reconnecter."
    );


    return;

  }


  const userEmail =
    document.getElementById(
      "userEmail"
    );


  if(userEmail){

    userEmail.textContent =
      currentUser?.email || "";

  }


  await loadAll();

}


/* =====================================================
   DÉCONNEXION
===================================================== */

function logout(showMessage=true){

  clearSession();

  showAuth();


  const email =
    document.getElementById(
      "email"
    );


  const password =
    document.getElementById(
      "password"
    );


  if(email){

    email.value = "";

  }


  if(password){

    password.value = "";

  }


  showError(
    showMessage
      ? "Vous êtes déconnecté."
      : ""
  );

}


const logoutButton =
  document.getElementById(
    "logoutButton"
  );


if(logoutButton){

  logoutButton.addEventListener(
    "click",
    function(){

      logout(true);

    }
  );

}


/* =====================================================
   NAVIGATION
===================================================== */

function showPage(pageId,button){

  document
    .querySelectorAll(".page")
    .forEach(function(page){

      page.classList.remove(
        "active"
      );

    });


  const page =
    document.getElementById(
      pageId
    );


  if(page){

    page.classList.add(
      "active"
    );

  }


  document
    .querySelectorAll(".nav-btn")
    .forEach(function(btn){

      btn.classList.remove(
        "active"
      );

    });


  if(button){

    button.classList.add(
      "active"
    );

  }else{

    document
      .querySelectorAll(".nav-btn")
      .forEach(function(btn){

        const onclick =
          btn.getAttribute(
            "onclick"
          ) || "";


        if(
          onclick.includes(
            "'" + pageId + "'"
          )
        ){

          btn.classList.add(
            "active"
          );

        }

      });

  }

}


/* =====================================================
   CHARGEMENT GLOBAL
===================================================== */

async function loadAll(){

  await Promise.allSettled([

    loadTasks(),

    loadEvents(),

    loadNotes(),

    loadBudget(),

    loadGoals(),

    loadSubscription()

  ]);


  updateDashboard();

}


/* =====================================================
   TÂCHES
===================================================== */

async function loadTasks(){

  try{

    const data =
      await api(
        "/api/tasks"
      );


    tasksData =
      data?.tasks ||
      data?.data ||
      [];


    if(!Array.isArray(tasksData)){

      tasksData = [];

    }


    renderTasks();


  }catch(error){

    console.error(
      "Erreur tâches:",
      error
    );


    tasksData = [];


    renderTasks(
      "Impossible de charger les tâches."
    );

  }

}


function renderTasks(
  errorMessage=""
){

  const list =
    document.getElementById(
      "tasksList"
    );


  if(!list)return;


  if(errorMessage){

    list.innerHTML =
      `<div class="empty">
        ${escapeHTML(errorMessage)}
      </div>`;

    return;

  }


  if(!tasksData.length){

    list.innerHTML =
      `<div class="empty">
        Aucune tâche pour le moment.
      </div>`;

    return;

  }


  list.innerHTML =
    tasksData.map(
      function(task){

        const priority =
          task.priority || "medium";


        const priorityLabel =
          priority === "high"
            ? "Haute"
            : priority === "low"
              ? "Faible"
              : "Moyenne";


        return `

          <div class="item">

            <div class="item-main">

              <div
                class="item-title"
                style="${
                  task.completed
                    ? "text-decoration:line-through;opacity:.6;"
                    : ""
                }"
              >

                ${escapeHTML(
                  task.title
                )}

              </div>

              <div class="item-small">

                Priorité :
                ${priorityLabel}

              </div>

            </div>


            <div class="item-actions">

              <button
                class="${
                  task.completed
                    ? "orange"
                    : "success"
                }"
                onclick="
                  toggleTask(
                    ${Number(task.id)},
                    ${!task.completed}
                  )
                "
              >

                ${
                  task.completed
                    ? "Annuler"
                    : "Terminer"
                }

              </button>


              <button
                class="danger"
                onclick="
                  deleteTask(
                    ${Number(task.id)}
                  )
                "
              >

                Supprimer

              </button>

            </div>

          </div>

        `;

      }
    ).join("");

}


async function addTask(){

  const input =
    document.getElementById(
      "taskTitle"
    );


  const priority =
    document.getElementById(
      "taskPriority"
    ).value;


  const title =
    input.value.trim();


  if(!title){

    alert(
      "Écrivez le nom de la tâche."
    );

    return;

  }


  try{

    await api(
      "/api/tasks",
      {
        method:"POST",

        body:
          JSON.stringify({

            title,

            priority

          })

      }
    );


    input.value = "";


    await loadTasks();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


async function toggleTask(
  id,
  completed
){

  try{

    await api(
      `/api/tasks/${id}`,
      {
        method:"PATCH",

        body:
          JSON.stringify({
            completed
          })

      }
    );


    await loadTasks();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


async function deleteTask(id){

  if(
    !confirm(
      "Supprimer cette tâche ?"
    )
  ){

    return;

  }


  try{

    await api(
      `/api/tasks/${id}`,
      {
        method:"DELETE"
      }
    );


    await loadTasks();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


/* =====================================================
   PLANNING
===================================================== */

async function loadEvents(){

  try{

    const data =
      await api(
        "/api/events"
      );


    eventsData =
      data?.events ||
      data?.data ||
      [];


    if(
      !Array.isArray(eventsData)
    ){

      eventsData = [];

    }


    renderEvents();


  }catch(error){

    console.error(
      "Erreur planning:",
      error
    );


    eventsData = [];


    renderEvents(
      "Impossible de charger le planning."
    );

  }

}


function renderEvents(
  errorMessage=""
){

  const list =
    document.getElementById(
      "eventsList"
    );


  if(!list)return;


  if(errorMessage){

    list.innerHTML =
      `<div class="empty">
        ${escapeHTML(errorMessage)}
      </div>`;

    return;

  }


  if(!eventsData.length){

    list.innerHTML =
      `<div class="empty">
        Aucun événement pour le moment.
      </div>`;

    return;

  }


  list.innerHTML =
    eventsData.map(
      function(event){

        return `

          <div class="item">

            <div class="item-main">

              <div class="item-title">

                ${escapeHTML(
                  event.title
                )}

              </div>


              <div class="item-small">

                ${escapeHTML(
                  event.event_date || ""
                )}

                ${
                  event.event_time
                    ? " — " +
                      escapeHTML(
                        event.event_time
                      )
                    : ""
                }

              </div>

            </div>


            <div class="item-actions">

              <button
                class="danger"
                onclick="
                  deleteEvent(
                    ${Number(event.id)}
                  )
                "
              >

                Supprimer

              </button>

            </div>

          </div>

        `;

      }
    ).join("");

}


async function addEvent(){

  const title =
    document
      .getElementById(
        "eventTitle"
      )
      .value
      .trim();


  const date =
    document
      .getElementById(
        "eventDate"
      )
      .value;


  if(!title || !date){

    alert(
      "Veuillez remplir le titre et la date."
    );

    return;

  }


  try{

    await api(
      "/api/events",
      {
        method:"POST",

        body:
          JSON.stringify({

            title,

            event_date:date

          })

      }
    );


    document
      .getElementById(
        "eventTitle"
      )
      .value = "";


    document
      .getElementById(
        "eventDate"
      )
      .value = "";


    await loadEvents();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


async function deleteEvent(id){

  if(
    !confirm(
      "Supprimer cet événement ?"
    )
  ){

    return;

  }


  try{

    await api(
      `/api/events/${id}`,
      {
        method:"DELETE"
      }
    );


    await loadEvents();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


/* =====================================================
   NOTES
===================================================== */

async function loadNotes(){

  try{

    const data =
      await api(
        "/api/notes"
      );


    notesData =
      data?.notes ||
      data?.data ||
      [];


    if(
      !Array.isArray(notesData)
    ){

      notesData = [];

    }


    renderNotes();


  }catch(error){

    console.error(
      "Erreur notes:",
      error
    );


    notesData = [];


    renderNotes(
      "Impossible de charger les notes."
    );

  }

}


function renderNotes(
  errorMessage=""
){

  const list =
    document.getElementById(
      "notesList"
    );


  if(!list)return;


  if(errorMessage){

    list.innerHTML =
      `<div class="empty">
        ${escapeHTML(errorMessage)}
      </div>`;

    return;

  }


  if(!notesData.length){

    list.innerHTML =
      `<div class="empty">
        Aucune note pour le moment.
      </div>`;

    return;

  }


  list.innerHTML =
    notesData.map(
      function(note){

        return `

          <div class="item">

            <div class="item-main">

              <div class="item-title">

                ${escapeHTML(
                  note.title
                )}

              </div>


              <div class="item-small">

                ${escapeHTML(
                  note.content
                )}

              </div>

            </div>


            <div class="item-actions">

              <button
                class="danger"
                onclick="
                  deleteNote(
                    ${Number(note.id)}
                  )
                "
              >

                Supprimer

              </button>

            </div>

          </div>

        `;

      }
    ).join("");

}


async function addNote(){

  const title =
    document
      .getElementById(
        "noteTitle"
      )
      .value
      .trim();


  const content =
    document
      .getElementById(
        "noteContent"
      )
      .value
      .trim();


  if(!title || !content){

    alert(
      "Veuillez remplir le titre et le contenu."
    );

    return;

  }


  try{

    await api(
      "/api/notes",
      {
        method:"POST",

        body:
          JSON.stringify({

            title,

            content

          })

      }
    );


    document
      .getElementById(
        "noteTitle"
      )
      .value = "";


    document
      .getElementById(
        "noteContent"
      )
      .value = "";


    await loadNotes();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


async function deleteNote(id){

  if(
    !confirm(
      "Supprimer cette note ?"
    )
  ){

    return;

  }


  try{

    await api(
      `/api/notes/${id}`,
      {
        method:"DELETE"
      }
    );


    await loadNotes();

    updateDashboard();


  }catch(error){

    alert(
    error.message
  );

  }

}


/* =====================================================
   BUDGET
===================================================== */

async function loadBudget(){

  try{

    const data =
      await api(
        "/api/budget"
      );


    budgetData =
      data?.budget ||
      data?.data ||
      [];


    if(
      !Array.isArray(budgetData)
    ){

      budgetData = [];

    }


    renderBudget();


  }catch(error){

    console.error(
      "Erreur budget:",
      error
    );


    budgetData = [];


    renderBudget(
      "Impossible de charger le budget."
    );

  }

}


function renderBudget(
  errorMessage=""
){

  const list =
    document.getElementById(
      "budgetList"
    );


  if(!list)return;


  if(errorMessage){

    list.innerHTML =
      `<div class="empty">
        ${escapeHTML(errorMessage)}
      </div>`;

    return;

  }


  let income = 0;
  let expense = 0;


  budgetData.forEach(
    function(item){

      const amount =
        Number(
          item.amount || 0
        );


      if(
        item.type === "income"
      ){

        income += amount;

      }else{

        expense += amount;

      }

    }
  );


  const balance =
    income - expense;


  const balanceElement =
    document.getElementById(
      "budgetBalance"
    );


  if(balanceElement){

    balanceElement.textContent =
      formatMoney(balance);


    balanceElement.className =
      "balance " +
      (
        balance >= 0
          ? "income"
          : "expense"
      );

  }


  const summary =
    document.getElementById(
      "budgetSummary"
    );


  if(summary){

    summary.textContent =
      `Revenus : ${formatMoney(income)} — Dépenses : ${formatMoney(expense)}`;

  }


  if(!budgetData.length){

    list.innerHTML =
      `<div class="empty">
        Aucune opération pour le moment.
      </div>`;

    return;

  }


  list.innerHTML =
    budgetData.map(
      function(item){

        const amount =
          Number(
            item.amount || 0
          );


        const isIncome =
          item.type === "income";


        return `

          <div class="item">

            <div class="item-main">

              <div class="item-title">

                ${escapeHTML(
                  item.description
                )}

              </div>

              <div class="item-small">

                ${
                  isIncome
                    ? "Revenu"
                    : "Dépense"
                }

              </div>

            </div>


            <div class="item-actions">

              <strong
                class="${
                  isIncome
                    ? "income"
                    : "expense"
                }"
              >

                ${
                  isIncome
                    ? "+"
                    : "-"
                }${formatMoney(amount)}

              </strong>


              <button
                class="danger"
                onclick="
                  deleteBudget(
                    ${Number(item.id)}
                  )
                "
              >

                Supprimer

              </button>

            </div>

          </div>

        `;

      }
    ).join("");

}


async function addBudget(){

  const description =
    document
      .getElementById(
        "budgetDescription"
      )
      .value
      .trim();


  const amount =
    Number(
      document
        .getElementById(
          "budgetAmount"
        )
        .value
    );


  const type =
    document
      .getElementById(
        "budgetType"
      )
      .value;


  if(!description){

    alert(
      "Veuillez entrer une description."
    );

    return;

  }


  if(
    !amount ||
    amount <= 0
  ){

    alert(
      "Veuillez entrer un montant valide."
    );

    return;

  }


  try{

    await api(
      "/api/budget",
      {
        method:"POST",

        body:
          JSON.stringify({

            description,

            amount,

            type

          })

      }
    );


    document
      .getElementById(
        "budgetDescription"
      )
      .value = "";


    document
      .getElementById(
        "budgetAmount"
      )
      .value = "";


    await loadBudget();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


async function deleteBudget(id){

  if(
    !confirm(
      "Supprimer cette opération ?"
    )
  ){

    return;

  }


  try{

    await api(
      `/api/budget/${id}`,
      {
        method:"DELETE"
      }
    );


    await loadBudget();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


/* =====================================================
   OBJECTIFS
===================================================== */

async function loadGoals(){

  try{

    const data =
      await api(
        "/api/goals"
      );


    goalsData =
      data?.goals ||
      data?.data ||
      [];


    if(
      !Array.isArray(goalsData)
    ){

      goalsData = [];

    }


    renderGoals();


  }catch(error){

    console.error(
      "Erreur objectifs:",
      error
    );


    goalsData = [];


    renderGoals(
      "Impossible de charger les objectifs."
    );

  }

}


function renderGoals(
  errorMessage=""
){

  const list =
    document.getElementById(
      "goalsList"
    );


  if(!list)return;


  if(errorMessage){

    list.innerHTML =
      `<div class="empty">
        ${escapeHTML(errorMessage)}
      </div>`;

    return;

  }


  if(!goalsData.length){

    list.innerHTML =
      `<div class="empty">
        Aucun objectif pour le moment.
      </div>`;

    return;

  }


  list.innerHTML =
    goalsData.map(
      function(goal){

        const target =
          Number(
            goal.target || 0
          );


        const progress =
          Number(
            goal.progress || 0
          );


        const percent =
          target > 0
            ? Math.min(
                100,
                Math.round(
                  progress /
                  target *
                  100
                )
              )
            : 0;


        return `

          <div class="item">

            <div class="item-main">

              <div class="item-title">

                ${escapeHTML(
                  goal.title
                )}

              </div>


              <div class="item-small">

                Progression :
                ${progress} / ${target}

              </div>


              <div class="progress">

                <div
                  class="progress-bar"
                  style="width:${percent}%"
                ></div>

              </div>

            </div>


            <div class="item-actions">

              <button
                class="success"
                onclick="
                  increaseGoal(
                    ${Number(goal.id)},
                    ${Math.min(
                      progress + 1,
                      target
                    )}
                  )
                "
                ${
                  progress >= target
                    ? "disabled"
                    : ""
                }
              >

                +1

              </button>


              <button
                class="danger"
                onclick="
                  deleteGoal(
                    ${Number(goal.id)}
                  )
                "
              >

                Supprimer

              </button>

            </div>

          </div>

        `;

      }
    ).join("");

}


async function addGoal(){

  const title =
    document
      .getElementById(
        "goalTitle"
      )
      .value
      .trim();


  const target =
    Number(
      document
        .getElementById(
          "goalTarget"
        )
        .value
    );


  if(!title){

    alert(
      "Veuillez entrer le nom de l'objectif."
    );

    return;

  }


  if(
    !target ||
    target <= 0
  ){

    alert(
      "Veuillez entrer une cible valide."
    );

    return;

  }


  try{

    await api(
      "/api/goals",
      {
        method:"POST",

        body:
          JSON.stringify({

            title,

            target

          })

      }
    );


    document
      .getElementById(
        "goalTitle"
      )
      .value = "";


    document
      .getElementById(
        "goalTarget"
      )
      .value = "";


    await loadGoals();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


async function increaseGoal(
  id,
  progress
){

  try{

    await api(
      `/api/goals/${id}`,
      {
        method:"PATCH",

        body:
          JSON.stringify({

            progress

          })

      }
    );


    await loadGoals();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


async function deleteGoal(id){

  if(
    !confirm(
      "Supprimer cet objectif ?"
    )
  ){

    return;

  }


  try{

    await api(
      `/api/goals/${id}`,
      {
        method:"DELETE"
      }
    );


    await loadGoals();

    updateDashboard();


  }catch(error){

    alert(
      error.message
    );

  }

}


/* =====================================================
   DASHBOARD
===================================================== */

function updateDashboard(){

  const statTasks =
    document.getElementById(
      "statTasks"
    );


  const statEvents =
    document.getElementById(
      "statEvents"
    );


  const statNotes =
    document.getElementById(
      "statNotes"
    );


  const statGoals =
    document.getElementById(
      "statGoals"
    );


  if(statTasks){

    statTasks.textContent =
      tasksData.length;

  }


  if(statEvents){

    statEvents.textContent =
      eventsData.length;

  }


  if(statNotes){

    statNotes.textContent =
      notesData.length;

  }


  if(statGoals){

    statGoals.textContent =
      goalsData.length;

  }

}


/* =====================================================
   FOCUS TIMER
===================================================== */

let timerSeconds =
  25 * 60;

let timerInterval =
  null;


function updateTimer(){

  const timer =
    document.getElementById(
      "timer"
    );


  if(!timer)return;


  const minutes =
    Math.floor(
      timerSeconds / 60
    );


  const seconds =
    timerSeconds % 60;


  timer.textContent =
    String(minutes)
      .padStart(2,"0")
    +
    ":"
    +
    String(seconds)
      .padStart(2,"0");

}


function startTimer(){

  if(timerInterval){

    return;

  }


  timerInterval =
    setInterval(
      function(){

        if(
          timerSeconds <= 0
        ){

          clearInterval(
            timerInterval
          );

          timerInterval =
            null;


          alert(
            "Votre session Focus est terminée."
          );


          return;

        }


        timerSeconds--;

        updateTimer();

      },
      1000
    );

}


function pauseTimer(){

  if(timerInterval){

    clearInterval(
      timerInterval
    );

    timerInterval =
      null;

  }

}


function resetTimer(){

  pauseTimer();

  timerSeconds =
    25 * 60;

  updateTimer();

}


/* =====================================================
   PREMIUM
===================================================== */

async function loadSubscription(){

  const status =
    document.getElementById(
      "premiumStatus"
    );


  const badge =
    document.getElementById(
      "premiumBadge"
    );


  const button =
    document.getElementById(
      "premiumButton"
    );


  if(!status)return;


  try{

    const data =
      await api(
        "/api/subscription/status"
      );


    const premium =
      data?.premium === true ||

      data?.isPremium === true ||

      data?.data?.premium === true ||

      data?.subscription?.status ===
        "active";


    isPremium =
      premium;


    if(premium){

      status.innerHTML =
        "Votre compte est actuellement <strong>Premium</strong>.";


      if(badge){

        badge.classList.remove(
          "hidden"
        );

      }


      if(button){

        button.textContent =
          "Premium activé";

        button.disabled =
          true;

      }


      updatePremiumUI(true);


    }else{

      status.innerHTML =
        "Votre compte utilise actuellement <strong>Lumio Free</strong>.";


      if(badge){

        badge.classList.add(
          "hidden"
        );

      }


      if(button){

        button.textContent =
          "Activer Premium — 250 HTG";

        button.disabled =
          false;

      }


      updatePremiumUI(false);

    }


  }catch(error){

    console.error(
      "Erreur abonnement:",
      error
    );


    isPremium =
      false;


    status.innerHTML =
      "Votre compte utilise actuellement <strong>Lumio Free</strong>.";


    if(badge){

      badge.classList.add(
        "hidden"
      );

    }


    updatePremiumUI(false);

  }

}


/* =====================================================
   AVANTAGES PREMIUM
===================================================== */

function updatePremiumUI(premium){

  const dashboardPremium =
    document.querySelector(
      "#dashboard .premium"
    );


  if(!dashboardPremium){

    return;

  }


  if(premium){

    dashboardPremium.innerHTML = `

      <h2>
        Lumio Premium activé
      </h2>

      <p
        style="margin:12px 0 18px"
      >
        Votre compte a accès aux avantages Premium.
      </p>

      <button
        class="primary"
        onclick="showPage('premium')"
      >
        Voir mes avantages
      </button>

    `;

  }else{

    dashboardPremium.innerHTML = `

      <h2>
        Lumio Premium
      </h2>

      <p
        style="margin:12px 0 18px"
      >
        Débloquez l'expérience Premium de Lumio.
      </p>

      <button
        class="primary"
        onclick="showPage('premium')"
      >
        Découvrir Premium
      </button>

    `;

  }

}


/* =====================================================
   ACTIVATION PREMIUM
===================================================== */

function activatePremium(){

  const result =
    document.getElementById(
      "paymentResult"
    );


  const button =
    document.getElementById(
      "premiumButton"
    );


  if(isPremium){

    if(result){

      result.className =
        "message show ok";

      result.textContent =
        "Votre compte Premium est déjà actif.";

    }

    return;

  }


  if(result){

    result.className =
      "message show ok";

    result.textContent =
      "Vous allez être redirigé vers Tchotchom pour payer 250 HTG.";

  }


  if(button){

    button.disabled =
      true;

    button.textContent =
      "Ouverture du paiement...";

  }


  /*
    IMPORTANT :

    Cette partie ne valide PAS automatiquement
    le paiement.

    Le paiement réel reste géré manuellement
    par le propriétaire de Lumio.

    Après réception du paiement,
    le propriétaire active Premium
    depuis le système prévu côté serveur.
  */


  setTimeout(
    function(){

      window.location.href =
        TCHOTCHOM_PAYMENT_URL;

    },
    700
  );

}


/* =====================================================
   CONFIRMATION / RAFRAÎCHISSEMENT PREMIUM
===================================================== */

async function refreshPremiumStatus(){

  try{

    await loadSubscription();

    if(isPremium){

      const result =
        document.getElementById(
          "paymentResult"
        );


      if(result){

        result.className =
          "message show ok";

        result.textContent =
          "Paiement confirmé. Votre compte Premium est maintenant actif.";

      }

    }

  }catch(error){

    console.error(
      "Erreur vérification Premium:",
      error
    );

  }

}


/* =====================================================
   INITIALISATION
===================================================== */

document.addEventListener(
  "DOMContentLoaded",
  function(){

    updateTimer();


    if(token){

      openApp();

    }else{

      showAuth();

    }

  }
);


/* =====================================================
   PROTECTION CONTRE LES ERREURS
===================================================== */

window.addEventListener(
  "error",
  function(event){

    console.error(
      "Erreur JavaScript Lumio:",
      event.error ||
      event.message
    );

  }
);


/* =====================================================
   FIN DU JAVASCRIPT
===================================================== */

</script>

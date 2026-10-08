/* =========================================================
   FIREBASE
========================================================= */

import { initializeApp }
from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
}
from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  get,
  onValue,
  onDisconnect,
  serverTimestamp,
  query,
  orderByChild,
  limitToLast,
  endAt
}
from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";


const firebaseConfig = {
  apiKey: "AIzaSyBreTSe1m0-xlbF4aupnU5isRZCihR25IE",
  authDomain: "formwheel.firebaseapp.com",
  databaseURL: "https://formwheel-default-rtdb.firebaseio.com",
  projectId: "formwheel",
  storageBucket: "formwheel.firebasestorage.app",
  messagingSenderId: "431583088241",
  appId: "1:431583088241:web:74e0e34ea1e3e1170c55d0",
  measurementId: "G-T372YXDF8D8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);


/* =========================================================
   STATE
========================================================= */

let currentUser = null;
let currentUserData = null;

let currentChatType = "public";
let currentRoomId = null;

let currentMessagesUnsub = null;
let currentTypingUnsub = null;
let roomsUnsub = null;
let usersUnsub = null;
let commandsUnsub = null;

let editingMessageId = null;
let banTargetUid = null;

let authMode = "login";

let allRooms = {};
let allUsers = {};
let allCommands = {};

let typingTimer = null;

let roomUnread = {};

const LOCAL_KEY = "formwheel_chat_local_v3";


/* =========================================================
   BASIC HELPERS
========================================================= */

function $(id){
  return document.getElementById(id);
}

window.$ = $;


function escapeHtml(value){

  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}


function formatTime(timestamp){

  if(!timestamp){
    return "";
  }

  const d = new Date(timestamp);

  if(Number.isNaN(d.getTime())){
    return "";
  }

  return d.toLocaleTimeString("ko-KR",{
    hour:"2-digit",
    minute:"2-digit"
  });
}


function formatRoomTime(timestamp){

  if(!timestamp){
    return "";
  }

  const d = new Date(timestamp);
  const now = new Date();

  if(
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ){
    return d.toLocaleTimeString("ko-KR",{
      hour:"2-digit",
      minute:"2-digit"
    });
  }

  return `${d.getMonth()+1}/${d.getDate()}`;
}


/* =========================================================
   LOCAL STORAGE
========================================================= */

function getLocalData(){

  try{

    const raw = localStorage.getItem(LOCAL_KEY);

    if(!raw){
      return {
        rooms:{},
        unread:{},
        lastChat:{
          type:"public",
          roomId:null
        }
      };
    }

    const data = JSON.parse(raw);

    return {
      rooms:data.rooms || {},
      unread:data.unread || {},
      lastChat:data.lastChat || {
        type:"public",
        roomId:null
      }
    };

  }catch(e){

    return {
      rooms:{},
      unread:{},
      lastChat:{
        type:"public",
        roomId:null
      }
    };

  }

}


function saveLocalData(){

  if(!currentUser){
    return;
  }

  const data = getLocalData();

  data.rooms = allRooms;
  data.unread = roomUnread;

  data.lastChat = {
    type:currentChatType,
    roomId:currentRoomId
  };

  localStorage.setItem(
    LOCAL_KEY,
    JSON.stringify(data)
  );
}


function loadLocalData(){

  const data = getLocalData();

  allRooms = data.rooms || {};
  roomUnread = data.unread || {};

  return data;
}


/* =========================================================
   AUTH
========================================================= */

window.switchAuth = function(mode){

  authMode = mode;

  $("loginTab").classList.toggle(
    "active",
    mode === "login"
  );

  $("signupTab").classList.toggle(
    "active",
    mode === "signup"
  );

  $("nicknameField").style.display =
    mode === "signup" ? "block" : "none";

  $("authButton").textContent =
    mode === "signup" ? "회원가입" : "로그인";

  $("authError").textContent = "";
};


window.submitAuth = async function(){

  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;
  const nickname = $("nicknameInput").value.trim();

  $("authError").textContent = "";

  if(!email || !password){

    $("authError").textContent =
      "이메일과 비밀번호를 입력해주세요.";

    return;
  }

  try{

    if(authMode === "signup"){

      if(!nickname){

        $("authError").textContent =
          "닉네임을 입력해주세요.";

        return;
      }

      if(nickname.length > 12){

        $("authError").textContent =
          "닉네임은 최대 12자입니다.";

        return;
      }

      const result =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

      await set(
        ref(db,`chatUsers/${result.user.uid}`),
        {
          uid:result.user.uid,
          nickname:nickname,
          email:email,
          role:"member",
          createdAt:Date.now()
        }
      );

    }else{

      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    }

  }catch(error){

    console.error(error);

    let message = "처리 중 오류가 발생했습니다.";

    if(error.code === "auth/invalid-credential"){
      message = "이메일 또는 비밀번호가 올바르지 않습니다.";
    }

    if(error.code === "auth/email-already-in-use"){
      message = "이미 가입된 이메일입니다.";
    }

    if(error.code === "auth/weak-password"){
      message = "비밀번호는 더 안전하게 설정해주세요.";
    }

    $("authError").textContent = message;
  }
};


window.logout = async function(){

  await signOut(auth);

};


/* =========================================================
   USER
========================================================= */

async function loadCurrentUser(){

  if(!currentUser){
    return;
  }

  const snap =
    await get(
      ref(db,`chatUsers/${currentUser.uid}`)
    );

  if(snap.exists()){

    currentUserData = snap.val();

  }else{

    currentUserData = {
      uid:currentUser.uid,
      nickname:
        currentUser.email?.split("@")[0] || "사용자",
      role:"member"
    };

    await set(
      ref(db,`chatUsers/${currentUser.uid}`),
      currentUserData
    );

  }

  $("userNameTop").textContent =
    currentUserData.nickname;

  if(currentUserData.role === "producer"){

    $("producerPanel").classList.add("show");

  }else{

    $("producerPanel").classList.remove("show");

  }

}


async function loadUsers(){

  if(usersUnsub){
    usersUnsub();
  }

  usersUnsub = onValue(
    ref(db,"chatUsers"),
    snapshot => {

      allUsers = snapshot.val() || {};

      renderUsers();

    }
  );

}


/* =========================================================
   ONLINE USERS
========================================================= */

async function setOnline(){

  if(!currentUser){
    return;
  }

  const onlineRef =
    ref(db,`chatOnline/${currentUser.uid}`);

  await set(
    onlineRef,
    {
      uid:currentUser.uid,
      nickname:currentUserData?.nickname || "사용자",
      at:Date.now()
    }
  );

  onDisconnect(onlineRef).remove();
}


function renderUsers(){

  const list = $("onlineList");

  const keyword =
    $("userSearchInput").value.trim().toLowerCase();

  list.innerHTML = "";

  Object.values(allUsers).forEach(user => {

    if(!user || !user.uid){
      return;
    }

    if(
      keyword &&
      !String(user.nickname || "")
        .toLowerCase()
        .includes(keyword)
    ){
      return;
    }

    const div =
      document.createElement("div");

    div.className = "onlineUser";

    div.innerHTML = `
      <span class="onlineDot"></span>
      <span class="onlineName">
        ${escapeHtml(user.nickname || "사용자")}
      </span>
      ${
        user.role === "producer"
        ? `<span class="roleText">Producer</span>`
        : ""
      }
    `;

    list.appendChild(div);

  });

}


/* =========================================================
   ROOMS
========================================================= */

function roomDisplayName(room){

  if(!room){
    return "";
  }

  return room.name || "이름 없는 채팅방";
}


async function loadRooms(){

  loadLocalData();

  if(roomsUnsub){
    roomsUnsub();
  }

  roomsUnsub = onValue(
    ref(db,"chatRooms"),
    snapshot => {

      const remoteRooms =
        snapshot.val() || {};

      const merged = {};

      Object.keys(remoteRooms).forEach(roomId => {

        const room = remoteRooms[roomId];

        if(!room){
          return;
        }

        if(
          room.members &&
          room.members[currentUser.uid]
        ){

          const old =
            allRooms[roomId] || {};

          merged[roomId] = {
            ...old,
            ...room,
            joinedAt:
              old.joinedAt ||
              room.joinedAt ||
              Date.now(),

            lastMessage:
              room.lastMessage ??
              old.lastMessage ??
              "",

            lastMessageAt:
              room.lastMessageAt ??
              old.lastMessageAt ??
              room.createdAt ??
              Date.now()
          };

        }

      });

      allRooms = merged;

      saveLocalData();

      renderRoomList();

    }
  );

}


function getSortedRooms(){

  return Object.entries(allRooms)
    .sort((a,b) => {

      const ta =
        Number(a[1].lastMessageAt || a[1].joinedAt || 0);

      const tb =
        Number(b[1].lastMessageAt || b[1].joinedAt || 0);

      return tb - ta;

    });

}


window.renderRoomList = function(){

  const list = $("roomList");

  const keyword =
    $("roomSearchInput").value.trim().toLowerCase();

  list.innerHTML = "";


  /* PUBLIC */

  const publicButton =
    document.createElement("button");

  publicButton.className =
    "roomItem" +
    (
      currentChatType === "public"
      ? " active"
      : ""
    );

  publicButton.onclick =
    () => openPublicChat();

  const publicUnread =
    Number(roomUnread.__public__ || 0);

  publicButton.innerHTML = `
    <div class="roomIcon">🌎</div>

    <div class="roomInfo">
      <div class="roomName">전체톡</div>
      <div class="roomPreview">FormWheel 전체 채팅</div>
    </div>

    <div class="roomMeta">
      ${
        publicUnread > 0
        ? `<span class="unread">${publicUnread > 99 ? "99+" : publicUnread}</span>`
        : ""
      }
    </div>
  `;

  if(
    !keyword ||
    "전체톡".includes(keyword) ||
    "formwheel".includes(keyword)
  ){

    list.appendChild(publicButton);

  }


  /* ROOMS */

  getSortedRooms().forEach(
    ([roomId,room]) => {

      const name =
        roomDisplayName(room);

      const code =
        room.code || "";

      if(
        keyword &&
        !name.toLowerCase().includes(keyword) &&
        !code.toLowerCase().includes(keyword)
      ){
        return;
      }

      const button =
        document.createElement("button");

      button.className =
        "roomItem" +
        (
          currentChatType === "room" &&
          currentRoomId === roomId
          ? " active"
          : ""
        );

      button.onclick =
        () => openRoom(roomId);

      const unread =
        Number(roomUnread[roomId] || 0);

      button.innerHTML = `
        <div class="roomIcon">💬</div>

        <div class="roomInfo">

          <div class="roomName">
            ${escapeHtml(name)}
          </div>

          <div class="roomPreview">
            ${escapeHtml(room.lastMessage || "채팅방")}
          </div>

        </div>

        <div class="roomMeta">

          ${
            room.lastMessageAt
            ? `<span class="roomTime">
                ${formatRoomTime(room.lastMessageAt)}
              </span>`
            : ""
          }

          ${
            unread > 0
            ? `<span class="unread">
                ${unread > 99 ? "99+" : unread}
              </span>`
            : ""
          }

        </div>
      `;

      list.appendChild(button);

    }
  );


  if(
    list.children.length === 1 &&
    Object.keys(allRooms).length === 0
  ){

    const empty =
      document.createElement("div");

    empty.className = "noRooms";

    empty.innerHTML =
      "아직 참여한 채팅방이 없어요.<br>새 채팅방을 만들어보세요!";

    list.appendChild(empty);

  }

};


/* =========================================================
   PUBLIC CHAT
========================================================= */

async function openPublicChat(){

  currentChatType = "public";
  currentRoomId = null;

  roomUnread.__public__ = 0;

  saveLocalData();

  $("chatTitle").textContent = "🌎 전체톡";

  $("chatSub").textContent =
    "FormWheel 전체 채팅";

  renderRoomList();

  closeMobileSidebar();

  startMessageListener("public");

}


window.openPublicChat = openPublicChat;


/* =========================================================
   OPEN ROOM
========================================================= */

async function openRoom(roomId){

  if(!currentUser){
    return;
  }

  const roomSnap =
    await get(
      ref(db,`chatRooms/${roomId}`)
    );

  if(!roomSnap.exists()){

    delete allRooms[roomId];

    saveLocalData();

    renderRoomList();

    return;
  }

  const room =
    roomSnap.val();

  if(
    !room.members ||
    !room.members[currentUser.uid]
  ){

    alert("이 채팅방에 입장할 수 없습니다.");

    return;
  }


  currentChatType = "room";
  currentRoomId = roomId;

  allRooms[roomId] = {
    ...(allRooms[roomId] || {}),
    ...room,
    joinedAt:
      allRooms[roomId]?.joinedAt ||
      Date.now()
  };

  roomUnread[roomId] = 0;

  saveLocalData();

  $("chatTitle").textContent =
    "💬 " + roomDisplayName(room);

  $("chatSub").textContent =
    `방 코드: ${room.code || "-"}`;

  renderRoomList();

  closeMobileSidebar();

  startMessageListener(`room_${roomId}`);

}


window.openRoom = openRoom;


/* =========================================================
   ROOM CREATION
========================================================= */

function generateRoomCode(){

  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let result = "";

  for(let i=0;i<6;i++){

    result +=
      chars[
        Math.floor(
          Math.random() * chars.length
        )
      ];

  }

  return result;
}


async function uniqueRoomCode(){

  for(let i=0;i<20;i++){

    const code =
      generateRoomCode();

    const snap =
      await get(
        ref(db,`roomCodes/${code}`)
      );

    if(!snap.exists()){
      return code;
    }

  }

  throw new Error("방 코드 생성 실패");
}


window.openCreateRoomModal =
function(){

  $("createRoomName").value = "";

  $("createRoomModal")
    .classList.add("show");

};


window.createRoom = async function(){

  const name =
    $("createRoomName").value.trim();

  if(!name){

    alert("채팅방 이름을 입력해주세요.");

    return;
  }

  try{

    const roomRef =
      push(ref(db,"chatRooms"));

    const roomId =
      roomRef.key;

    const code =
      await uniqueRoomCode();

    const now =
      Date.now();

    const room = {

      roomId,
      name,
      code,

      owner:currentUser.uid,

      createdAt:now,

      members:{
        [currentUser.uid]:true
      },

      lastMessage:"",
      lastMessageAt:now

    };

    await set(
      roomRef,
      room
    );

    await set(
      ref(db,`roomCodes/${code}`),
      roomId
    );


    allRooms[roomId] = {
      ...room,
      joinedAt:now
    };

    roomUnread[roomId] = 0;

    saveLocalData();

    closeModal("createRoomModal");

    await openRoom(roomId);

  }catch(error){

    console.error(error);

    alert("채팅방을 만들지 못했습니다.");

  }

};


/* =========================================================
   JOIN
========================================================= */

window.openJoinRoomModal =
function(){

  $("joinRoomCode").value = "";
  $("joinError").textContent = "";

  $("joinRoomModal")
    .classList.add("show");

};


window.joinRoomByCode =
async function(){

  const code =
    $("joinRoomCode")
      .value
      .trim();

  if(!code){

    $("joinError").textContent =
      "방 코드를 입력해주세요.";

    return;
  }

  const codeSnap =
    await get(
      ref(db,`roomCodes/${code}`)
    );

  if(!codeSnap.exists()){

    $("joinError").textContent =
      "존재하지 않는 방 코드입니다.";

    return;
  }

  const roomId =
    codeSnap.val();

  const roomSnap =
    await get(
      ref(db,`chatRooms/${roomId}`)
    );

  if(!roomSnap.exists()){

    $("joinError").textContent =
      "채팅방을 찾을 수 없습니다.";

    return;
  }

  const room =
    roomSnap.val();

  await update(
    ref(db,`chatRooms/${roomId}/members`),
    {
      [currentUser.uid]:true
    }
  );

  allRooms[roomId] = {
    ...room,
    members:{
      ...(room.members || {}),
      [currentUser.uid]:true
    },
    joinedAt:Date.now()
  };

  roomUnread[roomId] = 0;

  saveLocalData();

  closeModal("joinRoomModal");

  await openRoom(roomId);

};


/* =========================================================
   MESSAGE LISTENER
========================================================= */

function stopMessageListeners(){

  if(currentMessagesUnsub){
    currentMessagesUnsub();
    currentMessagesUnsub = null;
  }

  if(currentTypingUnsub){
    currentTypingUnsub();
    currentTypingUnsub = null;
  }

}


let messageCache=new Map(),messageNodes=new Map(),liveMessageIds=new Set(),historyMessageRef=null,messageGeneration=0;
function sortedCachedMessages(){return [...messageCache.values()].sort((a,b)=>Number(a.createdAt)-Number(b.createdAt)||a.id.localeCompare(b.id));}
async function loadEarlierMessages(){
 if(!historyMessageRef||!messageCache.size)return;const generation=messageGeneration;
 const oldest=sortedCachedMessages()[0],container=$("messages"),height=container.scrollHeight,top=container.scrollTop;
 const button=$("earlierMessages");button.disabled=true;
 try{const snap=await get(query(historyMessageRef,orderByChild("createdAt"),endAt(oldest.createdAt,oldest.id),limitToLast(51)));if(generation!==messageGeneration)return;
 let count=0;snap.forEach(child=>{if(child.key===oldest.id)return;messageCache.set(child.key,{id:child.key,...child.val()});count++;});
 renderMessages(sortedCachedMessages());container.scrollTop=top+container.scrollHeight-height;button.textContent=count?"이전 메시지 더 보기":"이전 메시지가 없습니다";button.disabled=count===0;
 }catch{button.disabled=false;button.textContent="이전 메시지 불러오기 실패 · 다시 시도";}
}
function startMessageListener(pathName){

  stopMessageListeners();messageGeneration++;messageCache.clear();messageNodes.clear();liveMessageIds.clear();
  let earlier=$("earlierMessages");if(!earlier){earlier=document.createElement("button");earlier.id="earlierMessages";$("messages").before(earlier);}earlier.textContent="이전 메시지 보기";earlier.disabled=false;earlier.onclick=loadEarlierMessages;
  $("messages").innerHTML = "";

  const messageRef =
    ref(
      db,
      pathName === "public"
      ? "chat/public/messages"
      : `chatRooms/${currentRoomId}/messages`
    );

  historyMessageRef=messageRef;
  const q =
    query(
      messageRef,
      orderByChild("createdAt"),
      limitToLast(200)
    );

  currentMessagesUnsub =
    onValue(
      q,
      snapshot => {

        const messages = [];

        snapshot.forEach(child => {

          messages.push({
            id:child.key,
            ...child.val()
          });

        });

        const ids=new Set(messages.map(m=>m.id));
        const first=messages[0];for(const id of liveMessageIds)if(!ids.has(id)){const old=messageCache.get(id);if(!first||Number(old?.createdAt)>Number(first.createdAt)||Number(old?.createdAt)===Number(first.createdAt)&&id>=first.id)messageCache.delete(id);}
        liveMessageIds=ids;for(const m of messages)messageCache.set(m.id,m);
        renderMessages(sortedCachedMessages());

      }
    );


  const typingPath =
    pathName === "public"
    ? "typing/public"
    : `typing/room_${currentRoomId}`;

  currentTypingUnsub =
    onValue(
      ref(db,typingPath),
      snapshot => {

        const data =
          snapshot.val() || {};

        const names =
          Object.values(data)
            .filter(v => v.uid !== currentUser.uid)
            .map(v => v.nickname);

        $("typing").textContent =
          names.length
          ? `${names.join(", ")} 입력 중...`
          : "";

      }
    );

}


function renderMessages(messages){

  const container =
    $("messages");

  const wasNearBottom =
    container.scrollHeight -
    container.scrollTop -
    container.clientHeight < 100;

  const desired=new Set(messages.map(m=>m.id));
  for(const [id,entry] of messageNodes)if(!desired.has(id)){entry.node.remove();messageNodes.delete(id);}
  let previous=null;


  messages.forEach(message => {
    const signature=JSON.stringify([message,allUsers[message.uid]?.role,currentUserData?.role]);
    const existing=messageNodes.get(message.id);
    if(existing?.signature===signature){if(existing.node.previousSibling!==previous)container.insertBefore(existing.node,previous?previous.nextSibling:container.firstChild);previous=existing.node;return;}
    existing?.node.remove();

    if(message.system){

      const system =
        document.createElement("div");

      system.className =
        "systemMessage";

      system.textContent =
        message.text || "";

      container.insertBefore(system,previous?previous.nextSibling:container.firstChild);previous=system;messageNodes.set(message.id,{signature,node:system});

      return;
    }


    const isMe =
      message.uid === currentUser.uid;

    const div =
      document.createElement("div");

    div.className =
      "message" +
      (isMe ? " me" : "");


    const role =
      allUsers[message.uid]?.role ||
      message.role ||
      "member";


    div.innerHTML = `

      <div class="avatar">
        ${isMe ? "🙂" : "👤"}
      </div>

      <div class="messageBody">

        <div class="messageTop">

          <span class="sender">
            ${escapeHtml(message.nickname || "사용자")}
          </span>

          ${
            role === "producer"
            ? `<span class="badge">Producer</span>`
            : ""
          }

          <span class="time">
            ${formatTime(message.createdAt)}
          </span>

        </div>

        <div class="bubble">
          ${escapeHtml(message.text || "")}

          ${
            message.edited
            ? `<span class="edited">(수정됨)</span>`
            : ""
          }
        </div>

        <div class="messageActions">

          ${
            isMe || currentUserData?.role === "producer"
            ? `
              <button data-message-action="edit" aria-label="메시지 수정">
                ✏️
              </button>
            `
            : ""
          }

          ${
            isMe || currentUserData?.role === "producer"
            ? `
              <button data-message-action="delete" aria-label="메시지 삭제">
                🗑️
              </button>
            `
            : ""
          }

          ${
            !isMe &&
            currentUserData?.role === "producer"
            ? `
              <button data-message-action="ban" aria-label="사용자 차단">
                🚫
              </button>
            `
            : ""
          }

        </div>

      </div>

    `;

    div.querySelector('[data-message-action="edit"]')?.addEventListener('click',()=>window.openEditMessage(message.id,message.text||""));
    div.querySelector('[data-message-action="delete"]')?.addEventListener('click',()=>window.deleteMessage(message.id));
    div.querySelector('[data-message-action="ban"]')?.addEventListener('click',()=>window.openBanModal(message.uid,message.nickname||"사용자"));
    container.insertBefore(div,previous?previous.nextSibling:container.firstChild);previous=div;messageNodes.set(message.id,{signature,node:div});

  });


  if(wasNearBottom || messages.length <= 1){

    container.scrollTop =
      container.scrollHeight;

  }

}


/* =========================================================
   SEND
========================================================= */

window.sendMessage = async function(){

  if(!currentUser){
    return;
  }

  const input =
    $("messageInput");

  const text =
    input.value.trim();

  if(!text){
    return;
  }


  /* COMMAND */

  if(text.startsWith("@")){

    const commandResult =
      await handleCommand(text);

    if(commandResult){
      input.value = "";
      stopTyping();
      return;
    }

  }


  const path =
    currentChatType === "public"
    ? "chat/public/messages"
    : `chatRooms/${currentRoomId}/messages`;

  const messageRef =
    push(ref(db,path));

  const now =
    Date.now();

  const message = {

    uid:currentUser.uid,

    nickname:
      currentUserData?.nickname ||
      "사용자",

    role:
      currentUserData?.role ||
      "member",

    text,

    createdAt:now,

    edited:false

  };


  await set(
    messageRef,
    message
  );


  /* ROOM SIDEBAR */

  if(currentChatType === "room"){

    const roomSnap =
      await get(
        ref(db,`chatRooms/${currentRoomId}`)
      );

    if(roomSnap.exists()){

      const room =
        roomSnap.val();

      const members =
        room.members || {};

      const updates = {};

      Object.keys(members).forEach(uid => {

        updates[
          `userChatMeta/${uid}/${currentRoomId}/lastMessage`
        ] = text;

        updates[
          `userChatMeta/${uid}/${currentRoomId}/lastMessageAt`
        ] = now;

      });

      updates[
        `chatRooms/${currentRoomId}/lastMessage`
      ] = text;

      updates[
        `chatRooms/${currentRoomId}/lastMessageAt`
      ] = now;

      await update(
        ref(db),
        updates
      );

    }

    allRooms[currentRoomId] = {
      ...(allRooms[currentRoomId] || {}),
      lastMessage:text,
      lastMessageAt:now
    };

  }else{

    /* PUBLIC */

    localStorage.setItem(
      "formwheel_chat_public_last",
      JSON.stringify({
        text,
        at:now
      })
    );

  }


  input.value = "";

  stopTyping();

  saveLocalData();

  renderRoomList();

};


window.handleMessageKey =
function(event){

  if(event.key === "Enter" && !event.shiftKey){

    event.preventDefault();

    sendMessage();

  }

};


/* =========================================================
   TYPING
========================================================= */

window.handleTyping = function(){

  if(!currentUser){
    return;
  }

  const path =
    currentChatType === "public"
    ? `typing/public/${currentUser.uid}`
    : `typing/room_${currentRoomId}/${currentUser.uid}`;


  set(
    ref(db,path),
    {
      uid:currentUser.uid,
      nickname:
        currentUserData?.nickname || "사용자"
    }
  );


  clearTimeout(typingTimer);

  typingTimer =
    setTimeout(
      stopTyping,
      1200
    );

};


function stopTyping(){

  if(!currentUser){
    return;
  }

  const path =
    currentChatType === "public"
    ? `typing/public/${currentUser.uid}`
    : `typing/room_${currentRoomId}/${currentUser.uid}`;

  remove(ref(db,path))
    .catch(()=>{});

}


/* =========================================================
   EDIT / DELETE
========================================================= */

window.openEditMessage =
function(id,text){

  editingMessageId = id;

  $("editInput").value =
    text || "";

  $("editModal")
    .classList.add("show");

};


window.saveEditedMessage =
async function(){

  if(!editingMessageId){
    return;
  }

  const text =
    $("editInput").value.trim();

  if(!text){
    return;
  }

  const path =
    currentChatType === "public"
    ? `chat/public/messages/${editingMessageId}`
    : `chatRooms/${currentRoomId}/messages/${editingMessageId}`;


  const snap =
    await get(ref(db,path));

  if(!snap.exists()){
    return;
  }

  const message =
    snap.val();


  if(
    message.uid !== currentUser.uid &&
    currentUserData?.role !== "producer"
  ){

    alert("이 메시지를 수정할 수 없습니다.");

    return;
  }


  await update(
    ref(db,path),
    {
      text,
      edited:true,
      editedAt:Date.now()
    }
  );


  editingMessageId = null;

  closeModal("editModal");

};


window.deleteMessage =
async function(id){

  const path =
    currentChatType === "public"
    ? `chat/public/messages/${id}`
    : `chatRooms/${currentRoomId}/messages/${id}`;


  const snap =
    await get(ref(db,path));

  if(!snap.exists()){
    return;
  }

  const message =
    snap.val();


  if(
    message.uid !== currentUser.uid &&
    currentUserData?.role !== "producer"
  ){

    alert("이 메시지를 삭제할 수 없습니다.");

    return;
  }


  if(!confirm("메시지를 삭제할까요?")){
    return;
  }

  await remove(
    ref(db,path)
  );

};


/* =========================================================
   EMOJI
========================================================= */

window.toggleEmoji =
function(){

  $("emojiPanel")
    .classList.toggle("show");

};


window.insertEmoji =
function(emoji){

  const input =
    $("messageInput");

  const start =
    input.selectionStart;

  const end =
    input.selectionEnd;

  const value =
    input.value;

  input.value =
    value.substring(0,start) +
    emoji +
    value.substring(end);

  input.focus();

  input.selectionStart =
    input.selectionEnd =
    start + emoji.length;

};


/* =========================================================
   PRODUCER
========================================================= */

async function loadCommands(){

  if(commandsUnsub){
    commandsUnsub();
  }

  commandsUnsub =
    onValue(
      ref(db,"chatCommands"),
      snapshot => {

        allCommands =
          snapshot.val() || {};

        renderCommands();

      }
    );

}


function renderCommands(){

  const list =
    $("commandList");

  if(!list){
    return;
  }

  list.innerHTML = "";

  Object.entries(allCommands)
    .forEach(([id,command]) => {

      const div =
        document.createElement("div");

      div.className =
        "commandItem";

      div.innerHTML = `
        <b>${escapeHtml(command.name)}</b>
        <span>${escapeHtml(command.text || "")}</span>
        <div style="margin-top:6px;">
          <button
            class="smallBtn"
            onclick="deleteCommand('${id}')">
            삭제
          </button>
        </div>
      `;

      list.appendChild(div);

    });

}


window.openCommandModal =
function(){

  if(currentUserData?.role !== "producer"){
    return;
  }

  $("commandName").value = "";
  $("commandText").value = "";
  $("commandAction").value = "message";

  $("commandModal")
    .classList.add("show");

};


window.saveCommand =
async function(){

  if(currentUserData?.role !== "producer"){
    return;
  }

  let name =
    $("commandName")
      .value
      .trim();

  const text =
    $("commandText")
      .value
      .trim();

  const action =
    $("commandAction").value;


  if(!name){
    alert("명령어를 입력해주세요.");
    return;
  }

  if(!name.startsWith("@")){
    name = "@" + name;
  }


  const commandRef =
    push(ref(db,"chatCommands"));

  await set(
    commandRef,
    {
      name,
      text,
      action,
      creator:currentUser.uid,
      createdAt:Date.now()
    }
  );


  closeModal("commandModal");

};


window.deleteCommand =
async function(id){

  if(currentUserData?.role !== "producer"){
    return;
  }

  if(!confirm("명령어를 삭제할까요?")){
    return;
  }

  await remove(
    ref(db,`chatCommands/${id}`)
  );

};


/* =========================================================
   COMMAND EXECUTION
========================================================= */

async function handleCommand(text){

  const parts =
    text.split(/\s+/);

  const name =
    parts[0];

  const command =
    Object.values(allCommands)
      .find(c =>
        String(c.name).toLowerCase() ===
        name.toLowerCase()
      );


  /* 기본 명령어 */

  if(name === "@봇소환"){

    await sendSystemMessage(
      "🤖 FormWheel Bot이 채팅에 등장했습니다!"
    );

    return true;

  }


  if(name === "@사용자검색"){

    const keyword =
      parts.slice(1).join(" ").trim();

    if(!keyword){

      await sendSystemMessage(
        "🔎 사용법: @사용자검색 닉네임"
      );

      return true;

    }


    const results =
      Object.values(allUsers)
        .filter(user =>
          String(user.nickname || "")
            .toLowerCase()
            .includes(keyword.toLowerCase())
        )
        .slice(0,10);


    if(results.length === 0){

      await sendSystemMessage(
        `🔎 "${keyword}" 사용자를 찾지 못했습니다.`
      );

    }else{

      await sendSystemMessage(
        "🔎 검색 결과: " +
        results
          .map(user => user.nickname)
          .join(", ")
      );

    }

    return true;

  }


  if(!command){
    return false;
  }


  if(command.action === "search"){

    const keyword =
      parts.slice(1).join(" ").trim();

    const results =
      Object.values(allUsers)
        .filter(user =>
          String(user.nickname || "")
            .toLowerCase()
            .includes(keyword.toLowerCase())
        )
        .slice(0,10);

    await sendSystemMessage(
      results.length
      ? "🔎 " + results.map(x => x.nickname).join(", ")
      : "🔎 검색 결과가 없습니다."
    );

    return true;
  }


  if(command.action === "bot"){

    await sendSystemMessage(
      `🤖 ${command.text || "Bot이 응답했습니다."}`
    );

    return true;

  }


  await sendSystemMessage(
    command.text || ""
  );

  return true;

}


/* =========================================================
   SYSTEM MESSAGE
========================================================= */

async function sendSystemMessage(text){

  const path =
    currentChatType === "public"
    ? "chat/public/messages"
    : `chatRooms/${currentRoomId}/messages`;


  const messageRef =
    push(ref(db,path));

  const now =
    Date.now();


  await set(
    messageRef,
    {
      system:true,
      text,
      createdAt:now
    }
  );


  if(currentChatType === "room"){

    const roomSnap =
      await get(
        ref(db,`chatRooms/${currentRoomId}`)
      );

    if(roomSnap.exists()){

      const room =
        roomSnap.val();

      const updates = {};

      Object.keys(room.members || {})
        .forEach(uid => {

          updates[
            `userChatMeta/${uid}/${currentRoomId}/lastMessage`
          ] = text;

          updates[
            `userChatMeta/${uid}/${currentRoomId}/lastMessageAt`
          ] = now;

        });


      updates[
        `chatRooms/${currentRoomId}/lastMessage`
      ] = text;

      updates[
        `chatRooms/${currentRoomId}/lastMessageAt`
      ] = now;


      await update(
        ref(db),
        updates
      );

    }

    allRooms[currentRoomId] = {
      ...(allRooms[currentRoomId] || {}),
      lastMessage:text,
      lastMessageAt:now
    };

    saveLocalData();

    renderRoomList();

  }

}


/* =========================================================
   BAN
========================================================= */

window.openBanModal =
function(uid,nickname){

  if(currentUserData?.role !== "producer"){
    return;
  }

  banTargetUid = uid;

  $("banTargetText").textContent =
    `${nickname} 사용자를 Ban합니다.`;

  $("banModal")
    .classList.add("show");

};


window.banUser =
async function(){

  if(
    !banTargetUid ||
    currentUserData?.role !== "producer"
  ){
    return;
  }

  const minutes =
    Number(
      $("banMinutes").value
    );

  const until =
    Date.now() +
    minutes * 60 * 1000;


  await set(
    ref(db,`chatBans/${banTargetUid}`),
    {
      uid:banTargetUid,
      until,
      by:currentUser.uid,
      createdAt:Date.now()
    }
  );


  closeModal("banModal");

  banTargetUid = null;

  await sendSystemMessage(
    `🚫 사용자가 ${minutes}분 동안 Ban되었습니다.`
  );

};


/* =========================================================
   BAN CHECK
========================================================= */

async function checkBan(){

  if(!currentUser){
    return false;
  }

  const snap =
    await get(
      ref(db,`chatBans/${currentUser.uid}`)
    );

  if(!snap.exists()){
    return false;
  }

  const ban =
    snap.val();

  if(
    ban.until &&
    Date.now() < ban.until
  ){

    alert(
      `현재 채팅이 제한되어 있습니다.\n` +
      `해제 시간: ${new Date(ban.until).toLocaleString("ko-KR")}`
    );

    return true;

  }

  await remove(
    ref(db,`chatBans/${currentUser.uid}`)
  );

  return false;

}


/* =========================================================
   BLOCK SEND IF BANNED
========================================================= */

const originalSendMessage =
  window.sendMessage;


/*
 * 실제 전송 전에 Ban을 확인하도록
 * sendMessage를 다시 정의한다.
 */
window.sendMessage =
async function(){

  const banned =
    await checkBan();

  if(banned){
    return;
  }

  return originalSendMessage();

};


/* =========================================================
   MODALS
========================================================= */

window.closeModal =
function(id){

  $(id).classList.remove("show");

};


window.showCurrentRoomInfo =
function(){

  if(currentChatType === "public"){

    alert(
      "🌎 전체톡\n\n" +
      "FormWheel 전체 채팅방입니다."
    );

    return;
  }


  const room =
    allRooms[currentRoomId];

  if(!room){
    return;
  }

  alert(
    `💬 ${room.name}\n\n` +
    `방 코드: ${room.code}\n` +
    `방장: ${allUsers[room.owner]?.nickname || "알 수 없음"}`
  );

};


/* =========================================================
   MOBILE
========================================================= */

window.toggleMobileSidebar =
function(){

  $("sidebar")
    .classList.toggle("mobileOpen");

  $("mobileOverlay")
    .classList.toggle("show");

};


window.closeMobileSidebar =
function(){

  $("sidebar")
    .classList.remove("mobileOpen");

  $("mobileOverlay")
    .classList.remove("show");

};


/* =========================================================
   ACTIVE CHAT RESTORE
========================================================= */

async function restoreLastChat(){

  const data =
    getLocalData();

  if(
    data.lastChat &&
    data.lastChat.type === "room" &&
    data.lastChat.roomId
  ){

    const roomId =
      data.lastChat.roomId;

    const roomSnap =
      await get(
        ref(db,`chatRooms/${roomId}`)
      );

    if(
      roomSnap.exists() &&
      roomSnap.val().members?.[currentUser.uid]
    ){

      await openRoom(roomId);

      return;

    }

  }

  await openPublicChat();

}


/* =========================================================
   AUTH STATE
========================================================= */

onAuthStateChanged(
  auth,
  async user => {

    currentUser = user;

    if(!user){

      $("loginScreen").style.display =
        "flex";

      $("mainApp").style.display =
        "none";

      stopMessageListeners();

      return;

    }


    $("loginScreen").style.display =
      "none";

    $("mainApp").style.display =
      "grid";


    await loadCurrentUser();

    loadLocalData();

    await setOnline();

    await loadUsers();

    await loadRooms();

    await loadCommands();

    await restoreLastChat();

  }
);


/* =========================================================
   AUTO CLOSE EMOJI
========================================================= */

document.addEventListener(
  "click",
  event => {

    const panel =
      $("emojiPanel");

    const button =
      event.target.closest(".iconBtn");

    if(
      panel.classList.contains("show") &&
      !panel.contains(event.target) &&
      !button
    ){

      panel.classList.remove("show");

    }

  }
);


/* =========================================================
   WINDOW CLOSE
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    stopTyping();

    saveLocalData();

  }
);

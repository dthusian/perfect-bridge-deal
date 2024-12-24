/// Config Options

const BRIDGE_CHANNEL = process.env["BRIDGE_CHANNEL"];
const MC_LOGS = process.env["MC_LOGS"];
const RCON_IP = process.env["RCON_IP"];
const RCON_PORT = process.env["RCON_PORT"];
const RCON_PASSWD = process.env["RCON_PASSWD"];
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const LANG_FILE = process.env["LANG_FILE"]; // used to extract death messages
const LOG_PARSE_PROFILE = process.env["LOG_PARSE_PROFILE"] || "vanilla";

/// Config Options End

/// Line Filtering Logic

function parseLangFile() {
  const langFile = JSON.parse(require("fs").readFileSync(LANG_FILE));
  const keys = Object.keys(langFile);
  return Array.from(keys)
    .filter(v => v.startsWith("death."))
    .map(v => {
      return ("" + langFile[v])
        .split(" ")
        .map(v => {
          if(v.startsWith("%")) {
            return "\\S+"
          } else {
            return v;
          }
        })
        .join("\\s+");
    })
    .map(v => new RegExp(v))
}
const deathMessageRegexes = parseLangFile();
deathMessageRegexes.push(/joined the game/);
deathMessageRegexes.push(/left the game/);
deathMessageRegexes.push(/has made the/);

function lineFilter(line) {
  // Chat messages
  if(line.includes(
    ({
      vanilla: "INFO]: <",
      forge: "DedicatedServer/]: <"
    })[LOG_PARSE_PROFILE]
  )) {
    return {
      author: line.substring(line.indexOf("<") + 1, line.indexOf(">")),
      content: line.substring(line.indexOf(">") + 2)
    };
  }
  
  if(line.includes("[Server thread/INFO]") && deathMessageRegexes.some(v => v.test(line))) {
    return {
      author: "",
      content: line.substring(line.lastIndexOf("]: ") + 3)
    }
  }
  return null;
}

/// Line Filtering Logic End

const djs = require("discord.js");
const REST = require("@discordjs/rest").REST;
const SlashCommandBuilder = require("@discordjs/builders").SlashCommandBuilder;
const Routes = require("discord-api-types/v9").Routes;
const rcon = require("rcon-client");
const tail = require("tail");

const bot = new djs.Client({
  intents: djs.Intents.FLAGS.GUILD_MESSAGES
});

const rest = new REST({ version: "9" }).setToken(DISCORD_TOKEN);

const rconclient = new rcon.Rcon({
  host: RCON_IP,
  port: RCON_PORT,
  password: RCON_PASSWD
});

let logwatcher;

// minecraft

rconclient.on("connect", () => {
  console.log("[INFO] rcon connected");
});

rconclient.on("error", err => {
  console.log("[ERR] rcon client error: " + err.message);
});

rconclient.on("end", v => {
  console.log("[ERR] rcon disconnected - exiting");
  process.exit(0);
});

logwatcher = new tail.Tail(MC_LOGS, { follow: true });

logwatcher.on("error", err => {
  console.log("[ERR] fs error: " + err.message);
});

function die() { process.exit(1); }

logwatcher.on("line", async line => {
  clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(die, 1000 * 60 * 10);
  const filteredContent = lineFilter(line);
  if(!filteredContent) return;
  if(filteredContent.author === null) return;
  let message, unbolded;
  if(filteredContent.author === "") {
    message = `[**MC**] ${filteredContent.content}`;
    unbolded = `[MC] ${filteredContent.content}`;
  } else {
    message = `[**MC ${filteredContent.author}**] ${filteredContent.content}`;
    unbolded = `[MC ${filteredContent.author}] ${filteredContent.content}`;
  }
  const channel = await bot.channels.fetch(BRIDGE_CHANNEL);
  if(!channel || !channel.isText()) {
    console.log("[ERR] couldn't find channel - check channel id");
    return;
  }
  console.log(`[MSG] ${unbolded}`);
  channel.send({
    content: message,
    allowedMentions: { parse: [] }
  });
});
watchdogTimer = setTimeout(die, 1000 * 60 * 10)

// discord

bot.on("messageCreate", v => {
  if(v.channelId === BRIDGE_CHANNEL && !v.author.bot) {
    if(!v.content && !v.attachments) {
      console.log("[WARN] no message content - setup message content intent");
      return;
    }
    const filteredContent = [v.content.replace(/[\r\n]+/g, " ")].concat(v.attachments.map(v => v.url)).join(" ");
    const msgobj = [
      {
        "text": "[Dscd ",
        "color": "blue"
      },
      {
        "text": v.author.username,
        "color": "white"
      },
      {
        "text": "] ",
        "color": "blue"
      },
      {
        "text": filteredContent,
        "color": "white"
      }
    ];
    rconclient.send("tellraw @a " + JSON.stringify(msgobj));
    console.log(`[MSG] [Dscd ${v.author.username}] ${filteredContent}`);
  }
});

bot.on("error", err => {
  console.log("[ERR] discord client error: " + err.message);
});

bot.on("ready", async () => {
  console.log("[INFO] discord connected");
  const channel = await bot.channels.fetch(BRIDGE_CHANNEL);
  if(!channel || !channel.isText()) {
    console.log("[ERR] couldn't find channel - check channel id");
    process.exit(0);
  }
  await rest.put(
    Routes.applicationGuildCommands(bot.user.id, channel.guildId),
    { body: [ 
      new SlashCommandBuilder().setName("list").setDescription("List online players").toJSON()
    ] }
  )
});

bot.on("interactionCreate", async v => {
  if(!v.isCommand()) return;
  if(v.commandName === "list") {
    const out = await rconclient.send("list");
    await v.reply({
      content: out
    });
  }
});

rconclient.connect();
bot.login(DISCORD_TOKEN);
logwatcher.watch();

/// Config Options

const BRIDGE_CHANNEL = process.env["BRIDGE_CHANNEL"];
const MC_LOGS = process.env["MC_LOGS"];
const RCON_IP = process.env["RCON_IP"];
const RCON_PORT = process.env["RCON_PORT"];
const RCON_PASSWD = process.env["RCON_PASSWD"];
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];

/// Config Options End

/// Line Filtering Logic

function lineFilter(line) {
  // Chat messages
  if(line.includes("INFO]: <")) {
    return {
      author: line.substring(line.indexOf("<") + 1, line.indexOf(">")),
      content: line.substring(line.indexOf(">") + 2)
    };
  }
  // Lines containing a known death message (or the join/leave message) are relevant
  const include = [
    "was shot by",
    "was pummeled by",
    "was pricked to death",
    "walked into a cactus",
    "drowned", // i hope builtin logs don't have this
    "experienced kinetic energy",
    "blew up",
    "was blown up by",
    "was killed by [Intentional Game Design]", // :trolley:
    "hit the ground too hard",
    "fell from a high place",
    "fell off a ladder",
    "fell off some vines",
    "fell off some weeping vines",
    "fell off some twisting vines",
    "fell off scaffolding",
    "fell while climbing",
    "was impaled on a stalagmite",
    "was squashed by a falling anvil",
    "was squashed by a falling block",
    "was skewered by a falling stalactite",
    "went up in flames",
    "walked into fire",
    "burned to death",
    "was burnt to a crisp",
    "went off with a bang",
    "tried to swim in lava", 
    "was struck by lightning",
    "discovered the floor was lava",
    "walked into danger zone due to",
    "was killed by magic",
    "using magic",
    "was killed by",
    "froze to death",
    "was frozen to death by",
    "was slain by",
    "was fireballed by",
    "was stung to death",
    "was shot by a skull from",
    "starved to death",
    "suffocated in a wall",
    "was squished too much",
    "was squashed by",
    "was poked to death by a sweet berry bush",
    "was killed trying to hurt",
    "trying to hurt",
    "was impaled by",
    "fell out of the world",
    "didn't want to live in the same world as",
    "withered away",
    "died from dehydration",
    "left the game",
    "joined the game",
    "has made the advancement",
    "has completed the challenge"
  ];
  // Villager death messages are printed to logs for some reason
  // Their death message is printed way after the debug info, ensure
  // if the death message isn't close enough to the beginning of the string,
  // reject
  if(line.includes("[Server thread/INFO]") && include.some(v => line.includes(v) && line.indexOf(v) < 60)) {
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

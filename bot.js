const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");
const OpenAI = require("openai");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const FORUM_CHANNEL_NAME = process.env.FORUM_CHANNEL_NAME || "👾-Game-Reviews";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID environment variable.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = [
  new SlashCommandBuilder()
    .setName("review")
    .setDescription("Create an AI-powered Roblox game review in the Game Reviews forum."),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show ReviewOc AI commands."),
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("Slash commands registered.");
}

async function makeAIReview({ game, link, rating, pros, cons, thoughts }) {
  if (!OPENAI_API_KEY) {
    return `**🤖 AI Review**

**Game:** ${game}
**Rating:** ⭐ ${rating}/10

**👍 Pros**
${pros}

**👎 Cons**
${cons}

**📝 Reviewer Notes**
${thoughts}

*AI generation is not configured yet. Add an OPENAI_API_KEY to enable ReviewOc AI's generated review text.*`;
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const response = await openai.responses.create({
    model: "gpt-5",
    instructions:
      "You are ReviewOc AI, a fair Roblox game reviewer. Write a concise, fun, honest review based ONLY on the information supplied by the user. Do not invent gameplay facts. Return plain Discord markdown with these headings: Verdict, What Stands Out, Pros, Cons, Who Should Play, Final Score. Keep it under 900 characters. The score must match the user's supplied rating out of 10.",
    input: `Game: ${game}
Roblox link: ${link}
User rating: ${rating}/10
Pros: ${pros}
Cons: ${cons}
User notes: ${thoughts}`,
    max_output_tokens: 500,
  });

  return response.output_text?.trim() || "Review generation failed.";
}

client.once("ready", () => {
  console.log(`ReviewOc AI is online as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "help") {
        await interaction.reply({
          ephemeral: true,
          content:
            "**ReviewOc AI 🤖**\n\n`/review` → Fill out a game review and ReviewOc AI will create a new post in `👾-Game-Reviews`.\n\nThe bot needs permission to view the forum, create posts/threads, and send messages in posts.",
        });
        return;
      }

      if (interaction.commandName === "review") {
        const modal = new ModalBuilder()
          .setCustomId("review_modal")
          .setTitle("ReviewOc AI • Game Review");

        const game = new TextInputBuilder()
          .setCustomId("game")
          .setLabel("Roblox game name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Example: Brookhaven RP")
          .setRequired(true)
          .setMaxLength(100);

        const link = new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Roblox game link")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("https://www.roblox.com/games/...")
          .setRequired(false)
          .setMaxLength(300);

        const rating = new TextInputBuilder()
          .setCustomId("rating")
          .setLabel("Rating out of 10")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("8")
          .setRequired(true)
          .setMaxLength(4);

        const pros = new TextInputBuilder()
          .setCustomId("pros")
          .setLabel("Pros")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Fun gameplay, good maps, active community...")
          .setRequired(true)
          .setMaxLength(700);

        const cons = new TextInputBuilder()
          .setCustomId("cons")
          .setLabel("Cons / your notes")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("A little repetitive, some bugs...")
          .setRequired(true)
          .setMaxLength(700);

        modal.addComponents(
          new ActionRowBuilder().addComponents(game),
          new ActionRowBuilder().addComponents(link),
          new ActionRowBuilder().addComponents(rating),
          new ActionRowBuilder().addComponents(pros),
          new ActionRowBuilder().addComponents(cons),
        );

        await interaction.showModal(modal);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "review_modal") {
      await interaction.deferReply({ ephemeral: true });

      const game = interaction.fields.getTextInputValue("game");
      const link = interaction.fields.getTextInputValue("link") || "Not provided";
      const ratingRaw = interaction.fields.getTextInputValue("rating");
      const pros = interaction.fields.getTextInputValue("pros");
      const cons = interaction.fields.getTextInputValue("cons");

      const rating = Number(ratingRaw);
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
        await interaction.editReply("❌ Rating must be a number from 0 to 10.");
        return;
      }

      const guild = interaction.guild;
      const forum = guild.channels.cache.find(
        channel =>
          channel.type === ChannelType.GuildForum &&
          channel.name === FORUM_CHANNEL_NAME
      );

      if (!forum) {
        await interaction.editReply(
          `❌ I couldn't find a Forum channel named \`${FORUM_CHANNEL_NAME}\` in this server.`
        );
        return;
      }

      const reviewText = await makeAIReview({
        game,
        link,
        rating,
        pros,
        cons,
        thoughts: cons,
      });

      const embed = new EmbedBuilder()
        .setTitle(`🎮 ${game}`)
        .setDescription(reviewText)
        .addFields(
          { name: "⭐ Score", value: `${rating}/10`, inline: true },
          { name: "👤 Reviewed by", value: `<@${interaction.user.id}>`, inline: true }
        )
        .setFooter({ text: "ReviewOc AI • Roblox Game Reviews" })
        .setTimestamp();

      if (link !== "Not provided") embed.setURL(link);

      const post = await forum.threads.create({
        name: `🎮 ${game} • ${rating}/10`,
        message: { embeds: [embed] },
        reason: "ReviewOc AI game review",
      });

      await interaction.editReply(`✅ Review posted: <#${post.id}>`);
    }
  } catch (error) {
    console.error(error);
    const message = "❌ Something went wrong while creating the review.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

registerCommands()
  .then(() => client.login(DISCORD_TOKEN))
  .catch(error => {
    console.error("Startup failed:", error);
    process.exit(1);
  });

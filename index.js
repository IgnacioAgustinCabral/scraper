const fastify = require("fastify")({ logger: true });
const puppeteer = require("puppeteer-extra");
const axios = require("axios");
const md5 = require("md5");

const cheerio = require("cheerio");
const moment = require("moment");

const URL = require("url");

const fs = require("fs");

const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

fastify.get("/source/facebook/json", async (req, reply) => {
  const html = await getContent(req.query);

  if (!html) {
    reply.statusCode = 500;
    return;
  }

  const urls = await getUrls(html, req.query.dominio);

  const originalUrls = await getOriginalUrls(urls);

  const data = await parseUrls(originalUrls);

  // const data = await get_data_facebook(html);
  reply.statusCode = 200;
  return dataTransform(data);
});

const parseUrls = async (urls) => {
  let json = [];
  for (let url of urls) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForSelector("body");
    const content = await page.content();
    await browser.close();

    const $ = cheerio.load(content);
    const scriptTags = $("script");
    let max_length = 0;
    let max_script = null;

    scriptTags.each(function () {
      // Check if 'data-content-len' attribute exists
      const lenAttr = $(this).attr("data-content-len");
      if (lenAttr) {
        // Get the length
        const length = parseInt(lenAttr, 10);
        // If this length is greater than max_length, update max_length and max_script
        if (length > max_length) {
          max_length = length;
          max_script = $(this);
        }
      }
    });

    let jsonData;

    // Access the nested properties
    try {
      jsonData = JSON.parse(max_script.html());
      const postText = findFirstKey(jsonData, "text");
      const unixTimestamp = findPublishTimeInTracking(jsonData, "publish_time");
      json.push({ postText, url, unixTimestamp });
    } catch (error) {
      console.error(
        "An error occurred while accessing the nested properties:",
        error
      );
    }
  }
  return json;
};

const getOriginalUrls = async (urls) => {
  const originalUrls = [];

  for (let url of urls) {
    try {
      const response = await axios.get(url);
      const linkHeader = response.headers.link;
      const match = linkHeader.match(/<(.*)>/);
      if (match) {
        const originalUrl = match[1];
        const parts = originalUrl.match(
          /(https:\/\/www\.facebook\.com\/.*\/(posts|videos)\/)(.*\/)?(\d+)/
        );
        if (parts) {
          const newUrl = parts[1] + parts[4];
          originalUrls.push(newUrl);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  return originalUrls;
};

// Recursive function to find the first occurrence of a key in a JSON object
function findFirstKey(obj, key) {
  if (obj && obj.hasOwnProperty(key)) {
    return obj[key];
  }
  for (let i in obj) {
    if (obj[i] && typeof obj[i] === "object") {
      let result = findFirstKey(obj[i], key);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

function findPublishTimeInTracking(obj) {
  if (obj && typeof obj["tracking"] === "string") {
    try {
      const trackingObj = JSON.parse(obj["tracking"]);
      return findFirstKey(trackingObj, "publish_time");
    } catch (error) {
      console.error("Error parsing tracking JSON:", error);
    }
  }
  for (let i in obj) {
    if (obj[i] && typeof obj[i] === "object") {
      let result = findPublishTimeInTracking(obj[i]);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

const dataTransform = (data) => {
  return data.map((item) => {
    return {
      url: item.url,
      hash: md5(item.url),
      content: item.postText,
      published_at: new Date(item.unixTimestamp * 1000),
    };
  });
};

const getContent = async ({ dominio, scroll, query_selector }) => {
  const url = `https://www.facebook.com/${dominio}`;

  const browser = await puppeteer.launch({ headless: true, slowMo: 250 });
  const page = await browser.newPage();
  await page.goto(url);

  await page.setViewport({
    width: 400,
    height: 1200,
  });

  await page.keyboard.press("Escape");

  await autoScroll(page, Number(scroll));

  const content = await page.evaluate(() => {
    return `<html>${document.documentElement.innerHTML}</html>`;
  });

  await browser.close();

  return content;
};

const getUrls = async (html, dominio) => {
  const regex = new RegExp(
    `https://www\\.facebook\\.com/${dominio}/posts/[a-zA-Z0-9]+`,
    "g"
  );
  const urls = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = match[0];
    if (!urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls;
};

async function autoScroll(page, scrollTimes) {
  for (let i = 0; i < scrollTimes; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Run the server!
const start = async () => {
  try {
    await fastify.listen(3003, "0.0.0.0");
    fastify.log.info(`server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
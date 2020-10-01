import MasterConfig from './watch-config.json';
import NotificationConfig from './notification-config.json';
import puppeteer from 'puppeteer';
import {Browser} from "puppeteer/lib/esm/puppeteer/common/Browser";
import {Page, WaitForOptions} from "puppeteer/lib/esm/puppeteer/common/Page";
import {JSONObject} from 'puppeteer/lib/esm/puppeteer/common/EvalTypes';
import nodemailer from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import fs from 'fs';
import util from 'util';

interface WatchConfig {
  store: string;
  url: string;
  refreshSeconds?: number;
  maxPrice?: number;
  expectedProductCount: number;
  outOfStockText?: string;
  maxTabs?: number;
  selectors: {
    product: string;
    productAttribute?: string;
    productURL?: string;
    productName: string;
    outOfStockSelector: string;
    price: string;
  }
}

interface Product {
  productName: null|string;
  productURL: null|string;
  outOfStock: null|boolean;
  price: null|number;
  errors?: Array<string>;
}

const log = (type: 'log'|'warn'|'error', message: any, verbose = false) => {
  const time = `${new Date().toLocaleTimeString()}: `;
  const logfile = type === 'log' ? "verbose.log" : "error.log"
  // Display to console
  if (!verbose || verbose && MasterConfig.verbose) {
    console[type](time, message);
  }
  // Log everything to the logfile
  fs.appendFileSync(logfile, time + util.format(message) + "\n");
}


class Watcher {
  page: Page;
  handle: NodeJS.Timeout;
  transporter?: Mail;

  constructor(public watchConfig: WatchConfig, public browser: Browser, public wait: (watchConfig: WatchConfig) => Promise<void>) {
    // Set up the notifier
    if (NotificationConfig) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: NotificationConfig.gmail,
          pass: NotificationConfig.password,
        }
      });  
    }

    // Run the check
    this.checkPage();

    log('log', `Initializing watch for ${this.watchConfig.store}`);
  }

  async checkPage(): Promise<void> {
    // Load the page
    try {
      await this.loadPage();
    } catch(err) {
      log('error', `Error loading page for ${this.watchConfig.store}.`);
      log('error', err, true);

      // Take a screenshot of the error
      await this.screenshot('error');

      // Set up the next check
      this.handle = setTimeout(() => this.checkPage(), MasterConfig.errorTimeSeconds*1000);

      // Close the page
      this.page.close();
      return;
    }

    // Fetch the product data
    const products = await this.getProducts();
    const inStock = this.inStock(products);
    const errors = this.errors(products);

    // Verbose logging
    log('log', `Results for ${this.watchConfig.store}:`, true);
    log('log', products, true);

    // Process the results
    if (errors.length > 0) {
      log('error', `Error checking stock at ${this.watchConfig.store}.`);
      log('error', errors, true);

      // Take a screenshot of the error
      await this.screenshot('error');

      // Set up the next check
      this.handle = setTimeout(() => this.checkPage(), MasterConfig.errorTimeSeconds*1000);
    } else if (inStock.length === 0) {
      log('log', `No stock at ${this.watchConfig.store}.`);

      // Set up the next check
      this.handle = setTimeout(() => this.checkPage(), this.watchConfig.refreshSeconds ? this.watchConfig.refreshSeconds*1000 : MasterConfig.defaultRefreshSeconds*1000);
    } else {
      // Send notification
      log('log', `In stock ${this.watchConfig.store}!!`);
      log('log', inStock, true);
      this.notify(inStock);

      // Take a screenshot
      await this.screenshot('success');

      // Set up the next check
      this.handle = setTimeout(() => this.checkPage(), MasterConfig.successTimeSeconds*1000);
    }
    // Close the page
    this.page.close();
  }

  async loadPage(): Promise<void> {
    // Set up the load options
    const timeout = 5000;
    const waitOptions: WaitForOptions = {waitUntil: 'networkidle2', timeout};

    // Wait for the queue to open
    await this.wait(this.watchConfig);

    // Create a new page
    this.page = await this.browser.newPage();

    // Load the page
    log('log', `Loading ${this.watchConfig.store}.`, true);
    try {
      await this.page.goto(this.watchConfig.url, { waitUntil: "networkidle0" });
    } catch (err) {
      log('warn', `Loading ${this.watchConfig.store} timed out.`, true);
    }

    // Wait for the selectors
    await this.page.waitForSelector(this.waitForSelector);
  }

  get waitForSelector(): string {
    const selectors = [`${this.watchConfig.selectors.product}`];
 
    for (var key in this.watchConfig.selectors) {
      if (key !== 'product') {
        selectors.push(`${selectors[0]} ${this.watchConfig.selectors[key]}`);
      }
    }
    return selectors.join(",");
  }

  errors(products: Array<Product>): Array<Product> {
    return products.filter(product=> product.errors?.length > 0);
  }

  inStock(products: Array<Product>): Array<Product> {
    return products.filter(product => 
      !product.outOfStock
      && product.price < (this.watchConfig.maxPrice ? this.watchConfig.maxPrice : MasterConfig.defaultMaxPrice)
    );
  }

  async notify(products: Array<Product>): Promise<void> {
    if (this.transporter) {
      this.transporter.sendMail({
        from: NotificationConfig.gmail,
        to: NotificationConfig.recipients.join(', '),
        subject: `${this.watchConfig.store} in Stock`,
        text: products.map(product => product.productURL).join('\n'),
      })
    }
  }

  async screenshot(type: 'error'|'success'): Promise<void> {
    log('log', `Taking ${type} screenshot.`, true);
    await this.page.screenshot({
      path: `./${type} - ${this.watchConfig.store} - ${new Date().getTime()}.png`,
      fullPage: true,
    });
  }

  async getProducts(): Promise<Array<Product>> {
    return this.page.evaluate((watchConfig: WatchConfig) => {
      // Get the product elements
      const products = document.querySelectorAll(watchConfig.selectors.product);

      const matches = [];
      let result: HTMLElement;

      // Iterate through the products to get the data for each product
      products.forEach((product) => {
        let productName: null|string = null;
        let productURL: null|string = null;
        let outOfStock: null|boolean = null;
        let price: null|number = null;
        let errors: Array<string>|undefined = [];
        try {
          if (!watchConfig.selectors.productAttribute) {
            productName = product.querySelector(watchConfig.selectors.productName).textContent.trim();
          } else {
            productName = product.querySelector(watchConfig.selectors.productName)[watchConfig.selectors.productAttribute].trim();
          }
        } catch (err) {
          errors.push('Product name');
        }
        try {
          if (watchConfig.selectors.productURL) {
            productURL = (product.querySelector(watchConfig.selectors.productURL) as HTMLAnchorElement).href;
          } else {
            productURL = watchConfig.url;
          }
        } catch(err) {
          errors.push('Product URL');
        }
        try {
          outOfStock = watchConfig.outOfStockText 
          ? Boolean(product.querySelector(watchConfig.selectors.outOfStockSelector)?.textContent.match(RegExp(watchConfig.outOfStockText, 'gi'))?.length > 0)
          : product.querySelector(watchConfig.selectors.outOfStockSelector) !== null
        } catch(err) {
          errors.push('Out of stock');
        }
        try {
          price = Number(product.querySelector(watchConfig.selectors.price).textContent.replace(/[^\d\.]/g, ''));
        } catch(err) {
          errors.push('Price');
        }
        if (errors && errors.length === 0) { errors = undefined; }
        matches.push({productName, productURL, outOfStock, price, errors });
      });

      // Make sure we have the expected number of results
      if (matches.length !== watchConfig.expectedProductCount) {
        if (matches.length === 0) {
          matches[0] = { errors: `Error loading page for ${watchConfig.store}.` };
        } else {
          matches[matches.length-1].errors = matches[matches.length-1].errors ? matches[matches.length-1].errors : [];
          matches[matches.length-1].errors.push(`Did not find the expected number of results for ${watchConfig.store}.  Expected ${watchConfig.expectedProductCount}, found ${matches.length}.`);
        }
      }
      return matches;
    }, this.watchConfig as unknown as JSONObject);
  }
}

class Main {
  browser: Browser;
  queue: Array<() => void> = [];

  constructor() {
    this.init();
  }

  async wait(watchConfig: WatchConfig): Promise<void> {
    let pages = await this.browser.pages();

    if (this.queue.length > 1 || pages.length-1 >= (MasterConfig.maxTabs ? MasterConfig.maxTabs : 10)) {
      log('log', `Max tabs already loaded.  Queuing check for ${watchConfig.store}.`, true);
      // Queue up the request
      return new Promise<void>((resolve) => {
        this.queue.push(() => {
          log('log', `Browser tab available, running check for ${watchConfig.store}.`, true);
          resolve();
        });
      });
    } else {
      log('log', `Tab available to run ${watchConfig.store}, running without waiting for queue.`, true);
    }
  }

  async init(): Promise<void> {
    // Set up the browser
    this.browser = await puppeteer.launch({
      headless: MasterConfig.headless === undefined ? true : MasterConfig.headless,
      defaultViewport: null,
      args: [
        '--window-size=1920,1080'
      ]
    });

    // Create the watches
    MasterConfig.watches
      // Filter out disabled stores
      .filter(watchConfig => {
        if (MasterConfig.disable?.length > 0) {
          return !MasterConfig.disable.find(disable => disable === watchConfig.store);
        }
        return true;
      })
      // Cycle through and stagger by 5s
      .forEach((watchConfig: WatchConfig, index: number) => {
        setTimeout(() => {
          new Watcher(watchConfig, this.browser, (watchConfig) => this.wait(watchConfig));
        }, 5*1000*index);
      });

    // Set up a loop to watch the queue
    setInterval(async () => {
      const pages = await this.browser.pages();
      if (this.queue.length > 0 && pages.length === 1) {
        this.queue.shift()();
      }
    }, 250)
  }
}

new Main();

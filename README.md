# RTX 3080 Watcher
> Yet another bot to watch etailing websites for changes in their out-of-stock status of NVIDA RTX 3080 cards.

This is a simple NodeJS project to provide notifications when various etailers replenish stock in NVIDIA RTX 3080 cards.  It's fairly flexible and can be modified via configuration file to monitor new websites and products.  The configuration file contains a list of websites and parameters to identify the page elements with the product information.

## Installation

* Clone the repo
* *Optional*: To receive notifications via gmail, copy or rename `/src/notification-config.json.sample` to `/src/notification-config.json` and update it with your gmail credentials and add recipients for the notifications
* *Optional*: Update `/src/watch-config.json` to add new websites or fix any issues with the current website checks
* Run `npx tsc` to recompile with the updated configuration
* Run `npm install` to install all the dependencies
* Run `npm run start` to start the bot

## Watch Configuration

Each watch configuration has the following parameters:

  * **store**: The name of the store
  * **url**: The URL of the site to check
  * **refreshSeconds**: (*Optional*) Number of seconds to wait between checks (defaults to the `defaultRefreshSeconds` in the main config)
  * **maxPrice**: (*Optional*) The max price you wish to pay (defaults to the `defaultMaxPrice` in the main config)
  * **expectedProductCount**: The number of products expected to match
  * **outOfStockText**: (*Optional*) A regular expression to search for in the `outOfStockSelector`
  * **maxTabs**: (*Optional*) The max number of websites to check at once (defaults to 10)
  * **selectors**: These are CSS selectors to search for the pertinent elements about the product.  The product info elements should be written as relative to the main product info element (i.e. the full path is not necessary).
    * **product**: The element containing all of the product information (for multi-product pages, this should return multiple nodes)
    * **productAttribute**: (*Optional*) The attribute if the name of the product resides within an attribute of a tag instead of the innerText of the element
    * **productURL**: (*Optional*) The URL to the product
    * **productName**: The name of the product 
    * **outOfStockSelector**: The button/message that says the product is out of stock
    * **price**: The prices of the product

## Release History

* 0.1.0
    * Initial release

## Meta

## Contributing

1. Fork it
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

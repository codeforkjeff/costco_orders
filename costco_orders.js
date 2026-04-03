// ==UserScript==
// @name         Costco Orders Download
// @namespace    http://tampermonkey.net/
// @version      0.1
// @author       codeforkjeff
// @description  Download all Costco warehouse orders in JSON format
// @match        https://www.costco.com/myaccount/*
// @grant        none
// @license      MIT
// ==/UserScript==

/*

# Costco Orders Download Script

## Description

This userscript captures raw data for Warehouse orders, and downloads it as JSON.

Adapted from https://gist.github.com/nano-shino/09e9b8702e77bf6598d727032054cd07

## Instructions

Click the "Orders & Returns" link at the top right of the Costco landing page. 

Click the "Download all warehouse orders" button in the top right corner of the page
to automatically click on each receipt in every time period and download the data as a JSON file.
When the process is finished, you'll see a popup that says "all done!"

*/
(function() {
    'use strict';

    const NUMERIC_REGEX = /(\d+)/g;

    function isStored(barcode) {
        for (let i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if(key == `barcode_${barcode}` && localStorage.getItem(key) != null) {
              return true;
          }
        }
        return false;
    }

    function storeOrder(barcode, data) {
        localStorage.setItem(`barcode_${barcode}`, data);
    }

    function getStoredOrders() {
        var results = {};
        for (let i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if(key.startsWith("barcode_")) {
            var barcode = key.split("_")[1];
            try {
              results[barcode] = JSON.parse(localStorage.getItem(key));
            } catch(error) {
                console.log(`error with key ${key}: ${error}`);
            }
          }
        }
        return results;
    }

    function clearOrders() {
        var keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          keys.push(localStorage.key(i));
        }
        for(var key of keys) {
            if(key.startsWith("barcode_")) {
                console.log(`removing ${key}`);
                localStorage.removeItem(key);
            }
        }
    }

    // patch XMLHttpRequest.open() so we can get the raw response data
    // from requests made to GraphQL endpoint
    function patchXMLHttpRequest() {
        (function(open) {
            XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
                if(url.indexOf("/ebusiness/order/v1/orders/graphql") > -1) {
                    const request = this;
                    this.addEventListener("readystatechange", function() {
                        if(request.readyState === XMLHttpRequest.DONE) {
                            //console.log(`THIS=${this.response}`);
                            var data = JSON.parse(this.response);
                            var barcode = data.data?.receiptsWithCounts?.receipts[0].transactionBarcode;
                            if(barcode) {
                                console.log(`storing ${barcode}`);
                                storeOrder(barcode, this.response);
                            } else {
                                console.log(`no barcode found in data: ${data}`);
                            }
                        }
                    }, false);
                }
                open.call(this, method, url, async, user, pass);
            };

        })(XMLHttpRequest.prototype.open);
    }

    // Function to wait for an element to appear
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const interval = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(interval);
                    resolve(element);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error(`Timeout waiting for ${selector}`));
                }
            }, 100);
        });
    }

    async function fetchOrders() {
        // make sure we're viewing Warehouse orders
        Array.from(document.querySelectorAll("button.MuiTab-root")).find(el => el.textContent=="Warehouse").click();
        await new Promise(resolve => setTimeout(resolve, 2000));

        // loop through different time periods
        const selectElement = document.querySelectorAll("select[name='Showing']")[0];
        const numPeriods = selectElement.options.length;

        for(var i = numPeriods - 1; i >= 0; i--) {
            console.log(`Selecting ${selectElement.options[i].value}`);
            selectElement.selectedIndex = i;
            selectElement.dispatchEvent(new Event('change', {bubbles: true}));

            await new Promise(resolve => setTimeout(resolve, 3000));

            var numPages = 1;
            try {
                await waitForElement('.MuiPaginationItem-page', 5000);
                numPages = document.querySelectorAll('.MuiPaginationItem-page').length;
            } catch(error) {
                // ignore
            }

            for(var page = 1; page <= numPages; page++) {

                if(page > 1) {
                    console.log(`Navigating to page ${page}`);
                    const gotoPageButton = document.querySelector(`button[aria-label="Go to page ${page}"]`);
                    gotoPageButton.click();
                }

                try {
                    await waitForElement('button[automation-id="ViewInWareHouseReciept"]', 5000);
                } catch(error) {
                    // ignore
                }

                const viewButtons = document.querySelectorAll('button[automation-id="ViewInWareHouseReciept"]');
                for (let button of viewButtons) {
                    var describedBy = button.getAttribute("aria-describedby");
                    var barcode = describedBy.split("_")[1];
                    if(!isStored(barcode)) {
                        button.click();
                        try {
                            await waitForElement('button[aria-label="Close"]', 10000);

                            // Close the popup
                            const closeButton = document.querySelector('button[aria-label="Close"]');
                            if (closeButton) closeButton.click();

                            // Wait for the popup to close
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        } catch (error) {
                            console.error('Error closing modal:', error);
                        }
                    } else {
                        console.log(`already in storage, skipping: ${barcode}`);
                    }
                }
            }

        }
    }

    function downloadJson() {
        if(localStorage.length > 0) {
            var orders = getStoredOrders();
            var a = document.createElement("a");
            document.body.appendChild(a);
            a.style = "display: none";
            var blob = new Blob([JSON.stringify(orders)], {type: "octet/stream"});
            var url = window.URL.createObjectURL(blob);
            a.href = url;
            a.download = "costco_orders_data.json";
            a.click();
            window.URL.revokeObjectURL(url);
        } else {
            alert("No data fetched, nothing to download");
        }
    };

    function addButtons() {

        const buttonStyle = {
            position: 'fixed',
            zIndex: '2147483647',
            padding: '12px 20px',
            backgroundColor: '#ff9800',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
            transition: 'all 0.3s ease'
        };

        const fetchButton = document.createElement('button');
        fetchButton.textContent = 'Download all warehouse orders';
        fetchButton.addEventListener('click', async function() {
            fetchButton.textContent = 'Working, hang on...';
            fetchButton.disabled = true;
            await fetchOrders();
            downloadJson();
            alert("all done!");
        });

        Object.assign(fetchButton.style, buttonStyle, { top: '20px', right: '20px' });

        fetchButton.addEventListener('mouseover', function() {
            this.style.backgroundColor = '#f57c00';
            this.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
        });
        fetchButton.addEventListener('mouseout', function() {
            this.style.backgroundColor = '#ff9800';
            this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
        });

        document.body.appendChild(fetchButton);

        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear stored orders';
        clearButton.addEventListener('click', async function() {
            clearButton.textContent = 'Working, hang on...';
            clearButton.disabled = true;
            clearOrders();
            alert("all done!");
        });

        Object.assign(clearButton.style, buttonStyle, { top: '100px', right: '20px' });

        clearButton.addEventListener('mouseover', function() {
            this.style.backgroundColor = '#f57c00';
            this.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
        });
        clearButton.addEventListener('mouseout', function() {
            this.style.backgroundColor = '#ff9800';
            this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
        });

        document.body.appendChild(clearButton);
    }

    patchXMLHttpRequest();
    addButtons();
})();

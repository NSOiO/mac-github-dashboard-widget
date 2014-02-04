/* 
 This file was generated by Dashcode.  
 You may edit this file to customize your widget or web page 
 according to the license.txt file included in the project.
 */

// Properties set by attributes panel
var numItemsToShow;         // Max number of items to display; -1 = all
var maxAgeToShow;           // Max age in days; 0 = today, -1 = all
var showDate;               // Whether to show the article dates
var feed = { url: null, title: "", baseURL: null };  // Object to hold information about the current feed
var lastUpdated = 0;                                 // Track last refresh time to avoid excessive updates
var lastResults = null;                              // Previous feed contents
var httpFeedRequest = null;                          // The current XMLHttpRequest
var loadingAnimationTimer = null;                    // Updates the "Loading..." animation's dots
var filterString = "";                               // String to filter results while searching
var slider;                                          // Article length slider element on the back

// Define some namespaces commonly used in feeds
var NS_DC = "http://purl.org/dc/elements/1.1/";
var NS_CONTENT = "http://purl.org/rss/1.0/modules/content/";
var NS_XHTML = "http://www.w3.org/1999/xhtml";

//
// Function: refreshFeed()
// Starts loading the feed source.
// processFeedDocument() will be called when it finishes loading.
//
function refreshFeed()
{
  //alert("Loading: "+ feed.url);
    if (!feed.url || feed.url.length < 1) {
        showMessageInContents(dashcode.getLocalizedString("No Feed Specified"),
            dashcode.getLocalizedString("Please specify a valid feed URL."));
        return false;
    }

    showLoadingMessage();

    // Abort any pending request before starting a new one
    if (httpFeedRequest != null) {
        httpFeedRequest.abort();
        httpFeedRequest = null;
    }
    httpFeedRequest = new XMLHttpRequest();

    // Function callback when feed is loaded
    httpFeedRequest.onload = function (e)
    {
        var feedRootElement;
        if (httpFeedRequest.responseXML) feedRootElement = httpFeedRequest.responseXML.documentElement;

        // Request is no longer pending
        httpFeedRequest = null;

        // Process the loaded document
        processFeedDocument(feedRootElement);
    }
    httpFeedRequest.overrideMimeType("text/xml");
    httpFeedRequest.open("GET", feed.url);
    httpFeedRequest.setRequestHeader("Cache-Control", "no-cache");

    // Send the request asynchronously
    httpFeedRequest.send(null);
}

//
// Function: processFeedDocument(doc)
// When the feed finishes loading, this function is called to parse it and display the results.
//
// doc: XML document containing the feed
//
function processFeedDocument(doc)
{
    hideLoadingMessage();
    if (doc) {
        // Remove the old entries
        clearContent();

        // Determine the feed type and call the appropriate parser
        var results;
        if (doc.tagName.toLowerCase() == "feed") {
            results = parseAtomFeed(doc);
        }
        else {
            // It's probably some version of RSS.
            // We don't care as long as it has <item>s
            results = parseRSSFeed(doc);
        }

        // Got no results?
        if (results == null || results.length < 1) {
            showMessageInContents(dashcode.getLocalizedString("No Items Found"),
                dashcode.getLocalizedString("The feed does not contain any entries."));
            return;
        }

        // Save unfiltered results
        lastResults = results;

        // Limit entries to top N, search terms, and date
        results = filterEntries(results);

        // Completely filtered out?
        if (results == null || results.length < 1) {
            showMessageInContents(dashcode.getLocalizedString("Nothing To Display"),
                dashcode.getLocalizedString("The feed does not contain any entries within the specified criteria."));
            return;
        }

        // Generate the display
        addEntriesToContents(results);

        // update the scrollbar so scrollbar matches new data
        refreshScrollArea();

        // Show new item indicator if necessary
        if (attributes.showUpdateBadge == 1) {
            checkNewItems(lastResults, results);
        }

        // set lastUpdated to the current time to keep track of the last time a request was posted
        lastUpdated = (new Date).getTime();
    }
    else {
        // document is empty
        showMessageInContents(dashcode.getLocalizedString("Invalid Feed"),
                              dashcode.getLocalizedString("%s does not appear to be a valid RSS or Atom feed.").replace("%s", feed.url));
    }
}

//
// Function: parseAtomFeed(atom)
// Parse an Atom feed.
//
// atom: Atom feed as an XML document.
//
// Returns the parsed results array.
//
function parseAtomFeed(atom)
{
    // Check for a global base URL
    var base = atom.getAttribute("xml:base");
    if (base) {
        feed.baseURL = splitURL(base);
    }

    var results = new Array;

    // For each element, get title, link and publication date.
    // Note that all elements of an item are optional.
    for (var item = atom.firstChild; item != null; item = item.nextSibling) {
        if (item.nodeName == "entry") {
            var title = atomTextToHTML(findChild(item, "title"));

            // we have to have the title to include the item in the list
            if (title) {
                // Just get the first link for now - Atom is complicated
                var link;
                var linkElement = findChild(item, "link");
                if (linkElement) {
                    link = linkElement.getAttribute("href");
                }

                // Try a few different ways to find a date
                var dateEl = findChild(item, "updated")
                    || findChild(item, "issued") 
                    || findChild(item, "modified")
                    || findChild(item, "created");
                var itemDate = parseDate(allData(dateEl));

                var description;
                var descElt = findChild(item, "content") || findChild(item, "summary");
                if (descElt) {
                    description = atomTextToHTML(descElt);
                }

                results[results.length] = {
                    title: title,
                    link: link,
                    date: itemDate,
                    description: description
                }
            }
        }
    }

    return results;
}

//
// Function: atomTextToHTML(element)
// Extracts the content of an atom text construct as HTML for display
//
// element: an Atom element containing an atomTextConstruct per RFC4287
//
// Returns an HTML div Element node containing the HTML
//
function atomTextToHTML(element)
{
    if (!element) {
        return;
    }

    var html;

    var type = element.getAttribute("type");
    if (type && (type.indexOf("xhtml") > -1)) {
        // The spec says there should be a DIV in the XHTML namespace
        var div = findChild(element, "div", NS_XHTML);
        if (div) {
            html = div.cloneNode(true);
        }
    }
    else if (type && (type.indexOf("html") > -1)) {
        // Encoded HTML
        html = document.createElement("div");
        html.innerHTML = allData(element);
    }
    else {
        // Plain text
        html = document.createElement("div");
        var elementText = allData(element);
        elementText = elementText.replace(/^\s+/, "");
        elementText = elementText.replace(/\s+$/, "");
        html.innerText = elementText;
    }

    return html;
}

//
// Function: parseRSSFeed(rss)
// Parse an RSS feed.
//
// rss: RSS feed as an XML document.
//
// Returns the parsed results array.
//
function parseRSSFeed(rss)
{
    var results = new Array;

    // Get global <link> element as base url
    var channel = findChild(rss, "channel");
    if (channel) {
        var mainLinkEl = findChild(channel, "link");
        if (mainLinkEl) {
            feed.baseURL = splitURL(allData(mainLinkEl));
        }
    }

    // Get all item elements.
    // For each element, get title, link and publication date.
    // Note that all elements of an item are optional.
    var items = rss.getElementsByTagName("item");
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.nodeName == "item") {
            var title = findChild(item, "title");

            // we have to have the title to include the item in the list
            if (title != null) {
                // get the link
                var link = findChild(item, "link");
                // get the date
                var dateEl = findChild(item, "pubDate") || findChild(item, "date", NS_DC);
                var itemDate = parseDate(allData(dateEl));
                // get the description
                var description = findChild(item, "encoded", NS_CONTENT) || findChild(item, "description");
                // save the result
                results[results.length] = {
                    title: allData(title),
                    link: allData(link),
                    date: itemDate,
                    description: allData(description)
                }
            }
        }
    }

    return results;
}

//
// Function: splitURL(url)
// Split components of the URL (protocol, domain, resource)
//
// url: URL to split
//
function splitURL(url)
{
    var baseURL = { protocol: "", domain: "", resource: "" };
    if (!url || url.length < 1) {
        return baseURL;
    }

    var components = url.split("://");
    baseURL.protocol = components[0];
    if (components.length > 1) {
        var slashIndex = components[1].indexOf("/");
        if (slashIndex >= 0) {
            baseURL.domain = components[1].substring(0, slashIndex);
            baseURL.resource = components[1].substring(slashIndex + 1, components[1].length);
        }
        else {
            baseURL.domain = components[1];
        }
    }
    
    return baseURL;
}

//
// Function: checkNewItems(oldResults, newResults)
// Determine how many new items have appeared since the last refresh.
//
// oldResults: Previously saved items for comparison.
// newResults: Array to search for new items.
//
function checkNewItems(oldResults, newResults)
{
    if (oldResults == null) {
        // Just starting up, so everything is new, and no need to say so.
        return;
    }

    if (oldResults.length == 0) {
        // If there are no old items, then all the new items are new
        if (newResults.length != 0) {
            // (If there are any)
            showNewCount(newResults.length);
            return;
        }
    }

    // Count the new items
    var newCount = 0;

    // Compare the last old item to the new items
    var oldItem = oldResults[0];
    for (var n = 0; n < newResults.length; n++) {
        var newItem = newResults[n];
        // Use the dates, if we're lucky enough to have them
        if (oldItem.date && newItem.date) {
            if (newItem.date > oldItem.date) {
                newCount++;
            }
            else {
                // Hit the end of the new stuff, so exit the loop
                break;
            }
        }
        else {
            // No date, so compare the titles
            if (newItem.title != oldItem.title) {
                newCount++;
            }
            else {
                // We've seen this title before, so exit the loop
                break;
            }
        }
    }

    if (newCount > 0) {
        showNewCount(newCount);
    }
}

//
// Function: createRow(title, link, date, description, index)
// Generate a new row for the content area.
//
// title: Article's title.
// link: Article's link.
// date: Article's date.
// description: Article's description.
// index: Row number for even/odd hilighting.
//
// Returns the created DIV element
//
function createRow(title, link, date, description, index)
{
    // create a DIV for the article
    var article = document.createElement("div");
    article.setAttribute("class", "article " + (index % 2 ? "even" : "odd"));
    // if it is not the first article, include a separation line
    if (index > 0) {
        var articleseparator = document.createElement("div");
        articleseparator.setAttribute("class", "articleseparator");
        article.appendChild(articleseparator);
    }

    // optionally, make the title a link
    var articlehead;
    if (link && link.length) {
        // if it is a relative link, make it absolute
        if (link.indexOf(":") < 0) link = absoluteURL(link);
        // set the link
        articlehead = document.createElement("a");
        articlehead.setAttribute("href", link);
    }
    else {
        articlehead = document.createElement("span");
    }
    articlehead.setAttribute("class", "articlehead");

    // title of the article
    var subjectElt = makeEntryDiv(title);
    subjectElt.setAttribute("class", "subject");
    articlehead.appendChild(subjectElt);

    // date of the article
    if (date != null && !isNaN(date.valueOf())) {
        var dateDiv = document.createElement("div");
        dateDiv.setAttribute ("class", "date");
        if (showDate) {
            dateDiv.innerText = createDateStr(date);
        }

        articlehead.appendChild(dateDiv);
    }

    article.appendChild(articlehead);

    // main body of the article
    if (description != null) {
        var descElt = makeEntryDiv(description);
        descElt.setAttribute("class", "articlebody");

        article.appendChild(descElt);
    }

    fixLinks(article);

    return article;
}

//
// Function: makeEntryDiv(content)
// Formats an entry's content as a div for display
//
// content: string or element containing an entry
//
function makeEntryDiv(content)
{
    var div;

    if (typeof content == "string") {
        // If it's a plain string, wrap it in a div
        div = document.createElement("div");
        div.innerHTML = content;
    }
    else {
        div = content;
    }

    return div;
}

//
// Function: addEntriesToContents(entries)
// Take the parsed results and display them in the content area.
//
// entries: Array of items to display.
//
function addEntriesToContents(entries)
{
    // copy title and date into rows for display. Store link so it can be used when user
    // clicks on title
    nItems = entries.length;

    var contentElement = document.getElementById("content");
    for (var i = 0; i < nItems; ++i) {
        var item = entries[i];
        var row = createRow(item.title, item.link, item.date, item.description, i);

        contentElement.appendChild(row);
    }
}

//
// Function: clearContent()
// Clear the current content area.
//
function clearContent()
{
    var content = document.getElementById("content");

    if (content) {
        while (content.hasChildNodes()) {
            content.removeChild(content.firstChild);
        }
    }
}

//
// Function: showMessageInContents(title, message)
// Display a status or error message in the content area.
//
// title: Title of message to display.
// message: Message text to display.
//
function showMessageInContents(title, message)
{
    clearContent();

    var titleElement = document.createElement("div");
    titleElement.setAttribute("class", "message-title");
    titleElement.innerText = title;

    var messageElement = document.createElement("div");
    messageElement.setAttribute("class", "message-body");
    messageElement.innerText = message;

    var contentElement = document.getElementById("content");
    contentElement.appendChild(titleElement);
    contentElement.appendChild(messageElement);

    refreshScrollArea();
}

//
// Function: showNewCount(newCount)
// Display a new-items indicator.
//
// newCount: Count of new items to display.
//
function showNewCount(newCount)
{
    setLoadingText(dashcode.getLocalizedString("%s new").replace("%s", newCount));
}

//
// Function: showLoadingMessage()
// Display "Loading..." and start the dots animating.
//
function showLoadingMessage()
{
    showElement("loading-text");
    startLoadingAnimation();
}

//
// Function: hideLoadingMessage()
// Stop and remove the "Loading..." animation.
//
function hideLoadingMessage()
{
    stopLoadingAnimation();
    hideElement("loading-text");
}

//
// Function: setLoadingText(loadingText)
// Display a message in the "Loading" area.
//
// loadingText: Text to display.
//
function setLoadingText(loadingText)
{
    var loadingElement = document.getElementById("loading-text");
    if (loadingElement) {
        loadingElement.innerText = loadingText;
        showElement("loading-text");
    }
}

//
// Function: startLoadingAnimation()
// Places animated "Loading..." text on the widget while the feed loads.
//
function startLoadingAnimation()
{
    var dots = 0;
    var animateLoadingDots = function ()
    {
        var loading = dashcode.getLocalizedString("Loading");
        for (var i = 0; i < dots; i++) {
            loading = loading + ".";
        }
        setLoadingText(loading);

        if (++dots > 3) {
            dots = 0;
        }
    };

    animateLoadingDots();
    loadingAnimationTimer = setInterval(animateLoadingDots, 500);
}

//
// Function: stopLoadingAnimation()
// Stop the "Loading..." animation.
//
function stopLoadingAnimation()
{
    if (loadingAnimationTimer != null) {
        clearInterval(loadingAnimationTimer);
        loadingAnimationTimer = null;
    }
}

//
// Function: filterEntries(entries)
// Narrow down the RSS entries by configured date or maximum limits.
//
// entries: Array of entries to filter.
//
// Returns array of entries matching the filter(s).
//
function filterEntries(entries)
{
    var result = new Array();

    // Set initial cutoff to "today" (midnight)
    var cutoffDate = new Date();
    cutoffDate.setHours(0, 0, 0, 0);

    // Max age is in days; 0 = today; -1 = "any date"
    // Subtract 24-hour periods to generate a cutoff date
    if (maxAgeToShow > 0) {
        cutoffDate.setTime(cutoffDate.getTime() - maxAgeToShow * 24 * 60 * 60 * 1000);
    }

    var regExp = new RegExp(filterString, "i");
    for (var i = 0; i < entries.length; i++) {
        // Have we reached the limit of items to show (-1 = all)
        if (numItemsToShow > 1 && i >= numItemsToShow)
            break;

        var entry = entries[i];
        var entryDate = entry.date;
        if (entryDate == null) {
            // No date, pretend it's today
            entryDate = new Date();
        }
        // Ignore cutoff date if "any date" (-1) was chosen
        if (maxAgeToShow == -1 || entryDate >= cutoffDate) {
            // If searching, filter by search string
            if (filterString==""
                || (entry.title && entry.title.match(regExp))
                || (entry.description && entry.description.match(regExp))){
                result.push(entry);
            }
        }
    }

    return result;
}

//
// Function: fixLinks(htmlFragment)
// Update hyperlinks in a document fragment to use the openURL function.
//
// htmlFragment: DOM element in which to adjust links.
//
function fixLinks(htmlFragment)
{
    // Collect all the links
    var links = htmlFragment.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
        var aNode = links[i];
        var href = aNode.getAttribute("href");
        // Make it absolute if it isn't already
        if (href && href.indexOf(":") < 0) {
            aNode.setAttribute("href", absoluteURL(href));
        }

        // Send them to our clickOnLink function
        aNode.addEventListener("click", clickOnLink, false);
    }
}


//
// Function: parseDate(dateToParse)
// Parse a date string in several formats into a Date object
//
// dateToParse: String containing a date.
//
// Returns a Date object containing the parsed date.
//
function parseDate(dateToParse)
{
    var returnDate = null;
    if (!dateToParse || dateToParse.length < 1) {
        return null;
    }
    
    // try to parse as date string
    returnDate = new Date(dateToParse);

    // if no success, try other formats
    if ((!returnDate || isNaN(returnDate.valueOf()))) {
        var dateTimeSeparator = null;
        var monthIndex = null;
        var dayIndex = null;
        var yearIndex = null;
        // try ISO 8601 format (YYYY-MM-DDTHH:MM:SS+OO:OO)
        if (dateToParse.match(/^\d\d\d\d-\d\d-\d\d/)) {
            dateTimeSeparator = "T";
            monthIndex = 1;
            dayIndex = 2;
            yearIndex = 0;
        }
        // try other format (MM-DD-YYYY HH:MM:SS)
        else if (dateToParse.match(/^\d\d-\d\d-\d\d\d\d/)) {
            dateTimeSeparator = " ";
            monthIndex = 0;
            dayIndex = 1;
            yearIndex = 2;
        }
        
        // if the date format was recognized, parse it
        if (dateTimeSeparator) {
            returnDate = new Date();
            // separate date and time
            var dateTime=dateToParse.split(dateTimeSeparator);

            // set the date
            var dateArray = dateTime[0].split("-");
            if (dateArray[monthIndex]) returnDate.setMonth(dateArray[monthIndex]-1);
            if (dateArray[dayIndex]) returnDate.setDate(dateArray[dayIndex]);
            if (dateArray[yearIndex]) returnDate.setYear(dateArray[yearIndex]);

            // split time and offset
            var timeArray = null;
            if (dateTime[1]) timeArray = dateTime[1].match(/(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:([+-])(\d\d):(\d\d))?/);
            if (timeArray) {
                // set the time
                if (timeArray[1]) returnDate.setHours(timeArray[1]);
                if (timeArray[2]) returnDate.setMinutes(timeArray[2]);
                if (timeArray[3]) returnDate.setSeconds(timeArray[3]);

                // add the offset
                if (timeArray[4] && timeArray[5]) {
                    var time = returnDate.getTime() - returnDate.getTimezoneOffset() * 60000;
                    if (timeArray[4] == "+")
                        time -= timeArray[5] * 3600000;
                    else
                        time += timeArray[5] * 3600000;
                    returnDate.setTime(time);
                }
            }
        }
    }

    // if no success, return null
    if (returnDate && isNaN(returnDate.valueOf())) {
        returnDate = null;
    }

    return returnDate;
}

//
// Function: findChild(element, nodeName, namespace)
// Scans the children of a given DOM element for a node matching nodeName, optionally in a given namespace.
//
// element: The DOM element to search.
// nodeName: The node name to search for.
// namespace: Optional namespace the node name must be in.
//
// Returns the child node if found, otherwise null.
//
function findChild(element, nodeName, namespace)
{
    var child;

    for (child = element.firstChild; child != null; child = child.nextSibling) {
        if (child.localName == nodeName) {
            if (namespace == null || child.namespaceURI == namespace)
                return child;
        }
    }

    return null;
}

//
// Function: allData(node)
// Concatenate all the text data of a node's children.
//
// node: DOM element to search for text.
//
// Returns the concatenated text.
//
function allData(node)
{
    var data = "";
    if (node && node.firstChild) {
        node = node.firstChild;
        if (node.data) data += node.data;
        while (node = node.nextSibling) {
            if (node.data) data += node.data;
        }
    }

    return data;
}

//
// Function: absoluteURL(url)
// Convert a relative URL into an absolute one using the feed's base URL
//
// url: Relative URL to convert.
//
// Returns the absolute URL.
//
function absoluteURL(url)
{
    if (!feed.baseURL) {
        return url;
    }

    var baseURL = feed.baseURL.protocol + "://" + feed.baseURL.domain;
    // if it is absolute within the domain
    if (url.indexOf("/") == 0) url = baseURL + url;
    // if it is relative to the current resorce
    else url = baseURL + "/" + feed.baseURL.resource + url;
    return url;
}

//
// Function: createDateStr(date)
// Generate a date label from a JavaScript date.
//
// date: JavaScript date object
//
// Returns a string containing the short date.
//
function createDateStr(date)
{
    var month;
    switch (date.getMonth()) {
        case 0: month = "Jan"; break;
        case 1: month = "Feb"; break;
        case 2: month = "Mar"; break;
        case 3: month = "Apr"; break;
        case 4: month = "May"; break;
        case 5: month = "Jun"; break;
        case 6: month = "Jul"; break;
        case 7: month = "Aug"; break;
        case 8: month = "Sep"; break;
        case 9: month = "Oct"; break;
        case 10: month = "Nov"; break;
        case 11: month = "Dec"; break;
    }
    return month + " " + date.getDate();
}

//
// Function: search(searchEvent)
// Filter displayed items by searching a substring.
//
// searchEvent: onSearch event from search field.
//
function search(searchEvent)
{
    // Set the new search string, escaping special rexexp characters
    var searchTerms = searchEvent.target.value;
    filterString = searchTerms.replace(/([\^\$\/\.\+\*\\\?\(\)\[\]\{\}\|])/ig, "\\$1");
    if (lastResults && lastResults.length) {
        // Remove the current entries
        clearContent();
        // Filter entries
        var searchResults = filterEntries(lastResults);
        // Got no results?
        if (searchResults == null || searchResults.length < 1) {
            showMessageInContents(dashcode.getLocalizedString("No Items Found"),
                dashcode.getLocalizedString("No items matched the search terms."));
        }
        else {
            // Generate the display
            addEntriesToContents(searchResults);
        }
        // update the scrollbar so scrollbar matches new data
        refreshScrollArea();
    }
}

//
// Function: clickOnLink()
// Called from onClick to open a link in the browser instead of in the widget.
//
function clickOnLink(e)
{
    if (window.widget) {
        widget.openURL(this.href);
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        return false;
    }
}

//
// Function: clickOnBottomRectangle(event)
// For testing, refresh the feed on option-clicking the bottom border.
//
// event: onClick event from widget.
//
function clickOnBottomRectangle(event)
{
    if (event.altKey) {
        refreshFeed();
    }
}

//
// Function: scaleArticles(value)
// Called by the article length slider.  Updates CSS to truncate articles.
//
// value: Percentage value from the slider.
//
function scaleArticles(value)
{
    var contentElement = document.getElementById("content");
    contentElement.style.appleLineClamp = value + "%";
}

//
// Function: scaleTo(value)
// Called by the article length max and min buttons. Update slider and scale articles.
//
// value: Percentage value to set the scale to.
//
function scaleTo(value)
{
    slider.value = value;
    scaleArticles( value );
}

//
// Function: scaleToMin()
// Called by the article length slider's minimum button.
//
function scaleToMin()
{
    scaleTo( slider.getAttribute("min") );
}

//
// Function: scaleToMax()
// Called by the article length slider's maximum button.
//
function scaleToMax()
{
    scaleTo( slider.getAttribute("max") );
}

//
// Function: refreshScrollArea()
// Updates the content areas's scroll bar when the content or article length has changed.
//
function refreshScrollArea()
{
    var contentarea = document.getElementById("contentarea");
    if (contentarea) contentarea.object.refresh();
}

//
// Function: hideElement(elementId)
// Turn off display for the given element.
//
// elementId: DOM id of the element to hide.
//
function hideElement(elementId)
{
    var element = document.getElementById(elementId);
    if (element)
        element.style.display = "none";
}

//
// Function: showElement(elementId)
// Turn on display for the given element.
//
// elementId: DOM id of the element to show.
//
function showElement(elementId)
{
    var element = document.getElementById(elementId);
    if (element)
        element.style.display = "block";
}

//
// Function: setFeedSource()
// Set the URL from where to get the feed.
//
// url: URL of the feed source
//
function setFeedSource(url) {
    if (url) {
        // make sure the url has an appropriate protocol
        url = url.replace(/^(feed:\/\/)/, "http://");
        if (url.indexOf("://") < 0) {
            url = "http://" + url;
        }
    }
    feed.url = url;
    feed.baseURL = splitURL(url);
}

function determineFeedSource() {
  if(window.widget) {
    username = widget.preferenceForKey("username");
    password = widget.preferenceForKey("password");
    if(username && username.length > 0 && password && password.length > 0) {
      setFeedSource("https://"+username+":"+password+"@github.com/"+username+".private.atom");
      document.getElementById("username_display").innerHTML = username;
    } else {
      setFeedSource("feed://github.com/repositories.atom");
      document.getElementById("username_display").innerHTML = "Recent Activity";
    }
  }
}

//
// Function: load()
// Called by HTML body element's onload event when the widget is ready to start
//
function load()
{
    dashcode.setupParts();

    numItemsToShow = +attributes.numItemsToShow;
    maxAgeToShow   = +attributes.maxAgeToShow;
    showDate       = attributes.showDate == 1;

    slider = document.getElementById("slider");
    scaleArticles(slider.value);
    
    determineFeedSource();
}

//
// Function: remove()
// Called when the widget has been removed from the Dashboard
//
function remove()
{
    // Stop any timers to prevent CPU usage
    // Remove any preferences as needed
    // widget.setPreferenceForKey(null, dashcode.createInstancePreferenceKey("your-key"));
}

//
// Function: hide()
// Called when the widget has been hidden
//
function hide()
{
    // Stop any timers to prevent CPU usage
}

//
// Function: show()
// Called when the widget has been shown
//
function show()
{
    // Refresh feed if 15 minutes have passed since the last update
    var now = (new Date).getTime();
    if ((now - lastUpdated) > 15 * 60 * 1000) {
        refreshFeed();
    }
}

//
// Function: sync()
// Called when the widget has been synchronized with .Mac
//
function sync()
{
    // Retrieve any preference values that you need to be synchronized here
    // Use this for an instance key's value:
    // instancePreferenceValue = widget.preferenceForKey(null, dashcode.createInstancePreferenceKey("your-key"));
    //
    // Or this for global key's value:
    // globalPreferenceValue = widget.preferenceForKey(null, "your-key");
}

//
// Function: showBack(event)
// Called when the info button is clicked to show the back of the widget
//
// event: onClick event from the info button
//
function showBack(event)
{
    var front = document.getElementById("front");
    var back = document.getElementById("back");

    if (window.widget)
        widget.prepareForTransition("ToBack");

    front.style.display="none";
    back.style.display="block";

    if (window.widget)
        setTimeout("widget.performTransition();", 0);
        
    document.getElementById("password").type = "password";
    if(widget.preferenceForKey("username")) document.getElementById("username").value = widget.preferenceForKey("username");
    if(widget.preferenceForKey("password")) document.getElementById("password").value = widget.preferenceForKey("password");
}

//
// Function: showFront(event)
// Called when the done button is clicked from the back of the widget
//
// event: onClick event from the done button
//
function showFront(event) {
  if(window.widget) {
    widget.setPreferenceForKey(document.getElementById("username").value,"username"); // save the new preference to disk
    widget.setPreferenceForKey(document.getElementById("password").value,"password"); // save the new preference to disk
	}
  determineFeedSource();
  refreshFeed();
  
  var front = document.getElementById("front");
  var back = document.getElementById("back");

  if (window.widget)
      widget.prepareForTransition("ToFront");

  front.style.display = "block";
  back.style.display = "none";

  if (window.widget)
      setTimeout("widget.performTransition();", 0);

  //refreshScrollArea();
}

// Initialize the Dashboard event handlers
if (window.widget) {
    widget.onremove = remove;
    widget.onhide = hide;
    widget.onshow = show;
    widget.onsync = sync;
}


var targetGroup = "A";
var targetCPL = 14;
var allowSurplusDistribution = false;

var SPREADSHEET_URL = '[Insert URL HERE]';
var defaultAllocation = "0.35-0.35-0.1-0.2";//iphone, cellShared, brand, shared
var allocation = [];
var allocationBackup = [];
var iPhoneBudget = 0;
var cellSharedCampaigns = ['Cell Phone', 'Samsung Phone', 'Pixel']
var cellSharedBudget = 0;
var brandBudget = 0;
var otherSharedCampaigns = [];
var sharedBudget = 0;
var extraSpend = 0;
var cellSharedName = "Cell Shared";
var sharedName = "Other Shared";
var accountName = "";
var resultCell = "";//the cell in the spreadsheet with dynamic notes
var pacingCell = "";//the cell in the spreadsheet with pacing health
var noError = true;//for setting campaign and budgets
var expectedSurplus = 0; //surplus from iphone and brand given to other and cell
var changedAllocation = false;//whether the script changed the allocation
var sheetRow = 0;
var ids = [];
var sheetRows = [];//the row on the sheet for the accounts in the same order as ids

// #Edit the following variables if you need to reformat the spreadsheet
// column numbers of each config column. Column A in your spreadsheet has
// column number of 1, B has number of 2, etc.
var COLUMN = {
  accountId: 2,
  accountGroup: 5,
  startDate: 8,
  endDate: 9,
  totalBudget: 13,
  results: 20,
  allocation: 3,
  pacing: 22,
  cpl: 23,
  canSpend: 24,
  toSpend: 25
};

// Actual config (without header and margin) starts from this row
var CONFIG_START_ROW = 2;

function main() {
	readSpreadSheet();
	getAccounts();
	setNewBudgets();
	Logger.log('Group ' + targetGroup + ' Done.');
}

function getAccounts(){
	mccAccount = AdWordsApp.currentAccount();
	var endRow = sheet.getLastRow();
	ids = []
	//Get account IDs
	for (var z = CONFIG_START_ROW; z <= endRow; z++) {
		var accountId = sheet.getRange(z, COLUMN.accountId).getValue();
		var accountGroup = sheet.getRange(z, COLUMN.accountGroup).getValue();
		
		//Split by 50 (parallel limit)
		if (accountGroup === targetGroup && accountId != ""){
			ids.push(accountId)
			sheetRows.push(z)
		}
	}
}

// Core logic for calculating and setting campaign daily budget
function setNewBudgets() {
  //Logger.log('Using spreadsheet - %s.', SPREADSHEET_URL);
  var spreadsheet = validateAndGetSpreadsheet(SPREADSHEET_URL);
  spreadsheet.setSpreadsheetTimeZone(AdWordsApp.currentAccount().getTimeZone());
  var sheet = spreadsheet.getSheets()[0];

  var mccAccount = AdWordsApp.currentAccount();

  //Go through accounts
  for (var q = 0; q < ids.length; q++) {
	sheetRow = sheetRows[q];
	z = sheetRow;
    var accountId = ids[q];
	resultCell = sheet.getRange(z, COLUMN.results);
	resultCell.setValue('');//Reset dynamic note cell

	var start = sheet.getRange(z, COLUMN.startDate).getDisplayValue();
	start = start + " 2:00:00 -0500";
	var startDate = new Date(start);
	var end = sheet.getRange(z, COLUMN.endDate).getDisplayValue();
	end = end + " 20:00:00 -0500";
    var endDate = new Date(end);
    var totalBudget = sheet.getRange(z, COLUMN.totalBudget).getValue();
	resultCell.setFontColor("black");
	allocation = []
	try{
		var allocation = sheet.getRange(z, COLUMN.allocation).getValue().split("-");
	}
	catch(err){
		resultCell.setValue('Wrong Allocation. ');
		resultCell.setFontColor("orange");
	}
	pacingCell = sheet.getRange(z, COLUMN.pacing);
	cplCell = sheet.getRange(z, COLUMN.cpl);
	
	//Logger.log('Processing account %s', accountId);

	if (allocation.length != 4){
		allocation = defaultAllocation;
		allocation = allocation.split("-");
	}
	
	try{
		var accountIter = MccApp.accounts().withIds([accountId]).get();
	}
	catch(err){
		resultCell.setValue('Check account ID. ');
		resultCell.setFontColor("red");
		continue
	}
    if (!accountIter.hasNext()) {
      resultCell.setValue('Account not found. ');
	  resultCell.setFontColor("red");
      continue;
    }

	
    var account = accountIter.next();
    MccApp.select(account);
	accountName = account.getName();
	
	if(checkAccountActive() == false){
	  resultCell.setValue('Campaigns are paused. ');
	  resultCell.setFontColor("blue");
	  continue;
	}
	else{
		otherSharedCampaigns = []
		getOtherCampaigns(account);
	}
	
	//Need to calculate budget according to account
	var today = new Date();
	var costSoFar = account.getStatsFor(//Failed to read from AdWords. Please wait a bit and try again.
      getDateStringInTimeZone('yyyyMMdd', startDate),
      getDateStringInTimeZone('yyyyMMdd', endDate)).getCost();
    var daysSoFar = datediff(startDate, today);
	var todayToEnd = datediff(today, endDate);
    var totalDays = datediff(startDate, endDate);
    var newBudget = calculateBudgetEvenly(costSoFar, totalBudget, daysSoFar, totalDays);

	Logger.log('PROCESSING ACCOUNT: ' + accountName + '(' + accountId + ')');
	/*Logger.log('Budget Start Date: ' + startDate);
	Logger.log('Budget End Date: ' + endDate);
	Logger.log('Account Budget: $' + totalBudget);
	Logger.log('Account Cost So Far: $' + costSoFar);
	Logger.log('Days So Far: ' + daysSoFar);
	Logger.log('Total Days: ' + totalDays);*/
	//Logger.log('Proposed Daily Budget: $' + newBudget);
	
	//Account Health 
	var timeElapsed = 1 - (todayToEnd/totalDays);
	//Logger.log("Time elapsed: " + timeElapsed);
	//Logger.log("Cost so far: " + costSoFar);
	//Logger.log("Total budget: " + totalBudget);
	var percentSpent = (costSoFar/totalBudget);
	//Logger.log("Percent spent: " + percentSpent);
	var delta = (percentSpent/timeElapsed)-1;
	delta = delta * 100
	delta = Math.round(delta * 100) / 100;//rounds to the 2nd decimal----
	
	cplCell.setFontColor("black");
	pacingCell.setFontColor("black");
	if(isFinite(delta)){
		//Logger.log("Delta: " + delta);
		//Logger.log("Pace: " + delta + "%");
		var prevPace = pacingCell.getValue();
		//Logger.log("Previous unedited: " + prevPace);
		prevPace = prevPace.toString().replace(/[a-zA-Z]*%|%/, '');
		if (prevPace.slice(-1) === "▼" || prevPace.slice(-1) === "▲"){
			prevPace = prevPace.substring(0, prevPace.length - 1);
		}
		else{
			prevPace = prevPace * 100;
		}
		//Logger.log("Previous pace edited: " + prevPace);
		prevPace = parseFloat(prevPace);
		//prevPace = prevPace * 100;
		//Logger.log("Previous pace to Float: " + prevPace);
		//Logger.log("New pace: " + delta);
		if (prevPace > delta){
			//Logger.log("▼");
			pacingCell.setValue(delta + "%▼");
		}
		else if(prevPace < delta){
			//Logger.log("▲");
			pacingCell.setValue(delta + "%▲");
		}
		else{
			//Logger.log("=");
			pacingCell.setValue(delta + "%");
		}
		
		pacingCell.setFontColor("black");
		pacingCell.setHorizontalAlignment("right")
		//Color Code Pacing Cells
		if (delta >= 15){
			pacingCell.setFontColor("red");
		}
		else if (delta >= 9){
			pacingCell.setFontColor("orange");
		}
		else if (delta <= -15){
			pacingCell.setFontColor("red");
		}
		else if (delta <= -9){
			pacingCell.setFontColor("orange");
		}
    }
	else if (isNaN(delta)){
		pacingCell.setFontColor("red");
		pacingCell.setValue("NaN error");
	}
	else{
		pacingCell.setFontColor("black");
		pacingCell.setValue("New Budget");
	}
	var cost30 = account.getStatsFor("LAST_30_DAYS").getCost();
	var conversions30 = account.getStatsFor("LAST_30_DAYS").getConversions();
	var cpl30 = cost30/conversions30;
	cpl30 = Math.round(cpl30);
	if(isFinite(cpl30)){
		cplCell.setValue("$" + cpl30);
		cplCell.setFontColor("black");
		var red = targetCPL + 10;
		var green = targetCPL - 5;
		if (cpl30 >= red){
			cplCell.setFontColor("red");
		}
		else if (cpl30 > targetCPL){
			cplCell.setFontColor("orange");
		}
	}
	else{
		cplCell.setFontColor("black");
		cplCell.setValue("");
	}

	
	
    if (today < startDate) {
		Logger.log("Budget not started. Today " + today + " < startDate " + startDate);
		resultCell.setValue('Budget not started. ');
		resultCell.setFontColor("blue");
		continue;
    }
	
	
    if (today > endDate) {
      resultCell.setValue('Skipped. Budget finished. ');
	  resultCell.setFontColor("blue");
      continue;
    }
	if(newBudget < 0){
		resultCell.setValue('Skipped. Budget less than 0. ');
		resultCell.setFontColor("blue");
		continue;	
	}
	
	calculateAccountPotentialSpend(sheet, account, newBudget);
	
	//Add extra spend to budget
	var extraSpendCell = sheet.getRange(z, COLUMN.toSpend)
	//extraSpendCell.setFontColor("black");
	extraSpend = extraSpendCell.getValue();
	extraSpend = parseFloat(extraSpend)
	if(isNaN(extraSpend)){
		extraSpend = 0;//deals with NaN error in allocation, if cell is blank
	}
	var availableExtraSpendCell = sheet.getRange(z, COLUMN.canSpend)
	var availableExtraSpend = availableExtraSpendCell.getValue();
	/*if( extraSpend > availableExtraSpend && availableExtraSpend < -10){
		resultCell.setValue("High budget. ");
		//Logger.log("Availablle: " + availableExtraSpend + " to Spend: " + extraSpend);
		if (availableExtraSpend < -25){
			availableExtraSpendCell.setFontColor("red");
		}
		else{
			availableExtraSpendCell.setFontColor("orange");
		}
	}*/
	//newBudget += extraSpend;
	newBudget = Math.round(newBudget * 100) / 100;
	Logger.log('Proposed Daily Budget: $' + newBudget + " + $" + extraSpend);
	
	//Divide budget
	allocationBackup = allocation.slice();
	iPhoneBudget = parseFloat(allocation[0]) * newBudget;
	iPhoneBudget = Math.round(iPhoneBudget * 100) / 100;
		//Logger.log("OG iPhone budget: " + iPhoneBudget);
	cellSharedBudget = parseFloat(allocation[1]) * newBudget;
	cellSharedBudget = Math.round(cellSharedBudget * 100) / 100;
		//Logger.log("OG cell budget: " + cellSharedBudget);
	brandBudget = parseFloat(allocation[2]) * newBudget;
	brandBudget = Math.round(brandBudget * 100) / 100;
		//Logger.log("OG Brand budget: " + brandBudget);
	sharedBudget = parseFloat(allocation[3]) * newBudget;
	sharedBudget = Math.round(sharedBudget * 100) / 100;
		//Logger.log("OG Other Shared: " + sharedBudget);
		
	/*//Check allocation sum
	var budgetallocationSum = parseFloat(allocation[0]) + parseFloat(allocation[1]) + parseFloat(allocation[2]) + parseFloat(allocation[3]);
	if (budgetallocationSum != 1){
		Logger.log("Budget Sum: " + budgetallocationSum);
		resultCell.setValue('Allocation total not 1');
		continue;
	}
	*/
	
	noError = true;
	setCampaignBudgets(accountId, startDate, endDate,-1,daysSoFar,totalDays);
	setSharedBudgets(accountId, startDate,endDate,-1,daysSoFar,totalDays);
	if (noError === true){
		var prev = resultCell.getValue();
		if (changedAllocation === true){
			
			//Calculate true allocation for information purposes
			var tot = iPhoneBudget + cellSharedBudget + brandBudget + sharedBudget;//I-C-B-O
			Logger.log("Final Budget: " + tot);
			var i = String((iPhoneBudget/tot).toFixed(2));//iphone true allocation
			var c = String((cellSharedBudget/tot).toFixed(2));//cell shared true allocation
			var b = String((brandBudget/tot).toFixed(2));//brand true allocation
			var o = String((sharedBudget/tot).toFixed(2));//other shared true allocation
			var percentAlloc = prev + "Set as " + i + "-" + c + "-" + b + "-" + o + " ";
			//Logger.log("True Allocation: " + percentAlloc);
			resultCell.setValue(percentAlloc);
			changedAllocation = false;
		}
		else{
			resultCell.setValue(prev + 'Budget Set. ');
		}
	}
	extraSpend = 0
	Logger.log('\n\n');
	//break;//activate if you only want to test on one account (the first one)
  }
	

  //update "Last execution" timestamp
  //sheet.getRange(1, 3).setValue(today);
  MccApp.select(mccAccount);
}

function calculateAccountPotentialSpend(sheet,account, dailyBudget){
	
	var extra = 0;//extra budget
	//Checks if campaign is old enough to have data back 30 days for this historical calculation.
	var bSLISquery = 'SELECT SearchBudgetLostImpressionShare FROM ACCOUNT_PERFORMANCE_REPORT ' +
	' DURING LAST_30_DAYS';
	var SISquery = 'SELECT SearchImpressionShare FROM ACCOUNT_PERFORMANCE_REPORT ' +
	' DURING LAST_30_DAYS';
	
	var impressionShareLossBudget = 0;
	var impressionShareLoss = 0;
	
	var reportIter = AdWordsApp.report(bSLISquery).rows();
	while (reportIter.hasNext()){
		var reportRow = reportIter.next();
		impressionShareLossBudget = parseFloat(reportRow.SearchBudgetLostImpressionShare);	
	}
	
	reportIter = AdWordsApp.report(SISquery).rows();
	while (reportIter.hasNext()){
		var reportRow = reportIter.next();
		impressionShareLoss = parseFloat(reportRow.SearchImpressionShare);	
	}
	//Logger.log("Account Impression Share Budget Loss: " + impressionShareLossBudget);
	//Logger.log("Account Impression Share: " + impressionShareLoss);
		
	var stats = account.getStatsFor("LAST_30_DAYS");
	var cost = stats.getCost();
	Logger.log("Cost 30: " + cost);
	//Maria Formula
	var couldHaveSpent = (impressionShareLossBudget * cost / 100)/(impressionShareLoss/100)
	var dailySpendProjection = couldHaveSpent/30
	dailySpendProjection = Math.round(dailySpendProjection * 100) / 100;
	
	
	//Adam Formula
/*	impressionShareLoss = (100 - impressionShareLoss) / 100;
	var couldHaveSpent = cost/impressionShareLoss;
	var dailySpendProjection = couldHaveSpent/30
	dailySpendProjection = Math.round(dailySpendProjection * 100) / 100;
	*/
	
	Logger.log("Daily spend projection: $" + dailySpendProjection);
	
	extra = dailySpendProjection - dailyBudget;//SlIS column in sheet set to this
	extra = Math.round(extra * 100) / 100;//round 4
	//Logger.log("Account can spend $" + extra + " extra daily.");
	var canSpendCell = sheet.getRange(sheetRow, COLUMN.canSpend);
	canSpendCell.setValue(extra);
	
}
function calculateCampaignPotentialSpend(campaign, campaignName, dailyBudget){
	if (campaign == null){
		return
	}
	//Check not limited by budget
	var budget = campaign.getBudget();
	
	
	var extra = 0;//extra budget
	//Checks if campaign is old enough to have data back 30 days for this historical calculation.
	var today = new Date();
	var campaignStart = campaign.getStartDate();
	var mo = campaignStart.month;
	mo = month(mo);
	var dateAsString = mo + " " + campaignStart.day + ", " + campaignStart.year + " 13:00:00 -0500";
	var start = new Date(dateAsString);
	var campaignAge = datediff(start, today);
	if (campaignAge > 45){//makes sure campaign has age to calculate based on history
		
		var bSLISquery = 'SELECT SearchBudgetLostImpressionShare FROM CAMPAIGN_PERFORMANCE_REPORT ' +
		' WHERE CampaignStatus = ENABLED' +
		' AND CampaignName = ' + campaignName +
		' DURING LAST_30_DAYS';
		var SISquery = 'SELECT SearchImpressionShare FROM CAMPAIGN_PERFORMANCE_REPORT ' +
		' WHERE CampaignStatus = ENABLED' +
		' AND CampaignName = ' + campaignName +
		' DURING LAST_30_DAYS';
		
		var impressionShareLossBudget = 0;
		var impressionShareLoss = 0;
		
		var reportIter = AdWordsApp.report(bSLISquery).rows();
		while (reportIter.hasNext()){
			var reportRow = reportIter.next();
			impressionShareLossBudget = parseFloat(reportRow.SearchBudgetLostImpressionShare);	
		}
		reportIter = AdWordsApp.report(SISquery).rows();
		while (reportIter.hasNext()){
			var reportRow = reportIter.next();
			impressionShareLoss = parseFloat(reportRow.SearchImpressionShare);	
		}
			
		var stats = campaign.getStatsFor("LAST_30_DAYS");
		var cost = stats.getCost();
		
		//Maria Formula
		var couldHaveSpent = (impressionShareLossBudget * cost / 100)/(impressionShareLoss/100)
		var dailySpendProjection = couldHaveSpent/30
		dailySpendProjection = Math.round(dailySpendProjection * 100) / 100;
		//Logger.log("Daily spend projection: $" + dailySpendProjection);
		
		
		extra = dailySpendProjection - dailyBudget;
		extra = Math.round(extra * 100) / 100;//round decimal
		Logger.log("     " + campaignName + " campaign has budget surplus: $" + extra);
		return extra
	}
	return 0;
}
function setCampaignBudgets(){
	//iPhone budget allocation
	var iPhoneCampaign = getCampaign("iPhone");
	var iPhonePotentialSpend = calculateCampaignPotentialSpend(iPhoneCampaign, "iPhone", iPhoneBudget);
	var str = "";
	if(iPhonePotentialSpend < 0 && allowSurplusDistribution == true){
		Logger.log("Excess budget found for iPhone.");
		iPhoneBudget += iPhonePotentialSpend;//subtracts excess budget. 
	}
	
	//available extra spend is going to iPhone first
	if(extraSpend > 0 && iPhonePotentialSpend > 0){
		//Logger.log("Extra spend going to iphone.");
		if(iPhonePotentialSpend < extraSpend){
			extraSpend = extraSpend - iPhonePotentialSpend;
			iPhoneBudget = iPhoneBudget + iPhonePotentialSpend;
		}
		else{
			iPhoneBudget += extraSpend;
			extraSpend = 0
		}
	}
	
	
	if (iPhoneCampaign != null){
		iPhoneBudget = Math.round(iPhoneBudget * 100) / 100;
		iPhoneCampaign.getBudget().setAmount(iPhoneBudget);
		//str = (parseFloat(allocationBackup[0]) * 100) + "%"; //designated allocation
		Logger.log('New iPhone budget: $' + iPhoneBudget);
	}
	else{//multiple iphone campaigns
		try{
			Logger.log("Multiple iPhone campaigns detected.");
			var iphoneIter = getCampaigns("iPhone");
			var iTotal = iphoneIter.totalNumEntities();
			var iCurrent = null;//current campaign
			var iBudget = iPhoneBudget/iTotal;//budget divided into the total number of iphone campaigns
			iBudget = Math.round(iBudget * 100) / 100;
			str = (parseFloat(allocationBackup[0]) * 100) + "%/" + iTotal;
			while (iphoneIter.hasNext()) {
				iCurrent = iphoneIter.next()
				iBudget = Math.round(iBudget * 100) / 100;
				iCurrent.getBudget().setAmount(iBudget);
				if(allowSurplusDistribution == false){
					Logger.log('BudgetName = %s, Designated Allocation = %s, New Budget = $%s, Total iPhone Budget = $%s', iCurrent.getName(), str, iBudget, iPhoneBudget);
				}
			}
		}
		catch(err){
			noError = false;
			var prev = resultCell.getValue();
			Logger.log(err);
			resultCell.setValue(prev + "iPhone campaign not found.");
			//expectedSurplus += iPhoneBudget;
			extraSpend += iPhoneBudget;
			iPhoneBudget = 0;
			changedAllocation = true;
			return;
		}
	}
	

	//Brand budget allocation
	var brandCampaign = getCampaign("Brand");
	var brandExtra = calculateCampaignPotentialSpend(brandCampaign, "Brand", brandBudget);
	if(brandExtra < 0 && allowSurplusDistribution == true){
		brandBudget += brandExtra;//subtracts excess budget
	}
	if (brandCampaign != null){
		brandBudget = Math.round(brandBudget * 100) / 100;
		brandCampaign.getBudget().setAmount(brandBudget);
		//str = (parseFloat(allocationBackup[2]) * 100) + "%"; //designated allocation
		Logger.log('New Brand budget: $' + brandBudget);
	}
	else{//multiple brand campaigns
		try{
			Logger.log("Multiple Brand campaigns detected.");
			var brandIter = getCampaigns("Brand");
			var bTotal = brandIter.totalNumEntities();
			var bCurrent = null;//current campaign
			var bBudget = brandBudget/bTotal;//budget divided into the total number of iphone campaigns
			bBudget = Math.round(bBudget * 100) / 100;
			str = (  Float(allocationBackup[2]) * 100) + "%/" + bTotal;
			while (brandIter.hasNext()) {
				bCurrent = brandIter.next()
				bBudget = Math.round(bBudget * 100) / 100;
				bCurrent.getBudget().setAmount(bBudget);
				if(allowSurplusDistribution == false){
					Logger.log('BudgetName = %s, Designated Allocation = %s, New Budget = $%s, Total Brand Budget = $%s', bCurrent.getName(), str, bBudget, brandBudget);
				}
			}
		}
		catch(err){
			noError = false;
			var prev = resultCell.getValue();
			Logger.log(err);
			resultCell.setValue(prev + "Brand campaign not found.");
			expectedSurplus += brandBudget;
			return;
		}
	}
	
	if (!brandExtra > 0){
		Logger.log("Excess budget found for Brand.");
		
	}
	
	//Surplus distribution
	if(allowSurplusDistribution == true){
		Logger.log("Total Surplus added to other shared and cell shared: $" + expectedSurplus);
		var half = expectedSurplus / 2;
		//Logger.log("Surplus additions: " + half);
		//Logger.log("Simple cell budget " + cellSharedBudget)
		cellSharedBudget = cellSharedBudget + half;
		cellSharedBudget = Math.round(cellSharedBudget * 100) / 100;//round decimal
		//Logger.log("Simple other budget " + sharedBudget);
		sharedBudget = sharedBudget + half;
		sharedBudget = Math.round(sharedBudget * 100) / 100;//round decimal
		expectedSurplus = Math.round(expectedSurplus * 100) / 100;//round decimal
		//Logger.log("Total surplus from Brand & iPhone: $" + expectedSurplus);
	}
	expectedSurplus = 0;
}

function setSharedBudgets(accountId, startDate,endDate,costSoFar,daysSoFar,totalDays){
	//Get cell shared
	var budgetSelector = AdWordsApp.budgets().withCondition("BudgetName = 'Cell Shared'");
	var budgetIter = budgetSelector.get();
	try{
		var cellBudgetObject = budgetIter.next();
	}
	catch(err){
		Logger.log("Error on setSharedBudget: " + err);
		noError = false;
		var prev = resultCell.getValue();
		resultCell.setValue(prev + "Cell Shared not found.");
		return
	}
	//Set budget
	extraSpend = extraSpend/2;
	extraSpend = Math.round(extraSpend * 100)/100;
	cellSharedBudget += extraSpend;
	cellBudgetObject.setAmount(cellSharedBudget);
	//var str = (parseFloat(allocationBackup[1]) * 100) + "%"
	Logger.log('New Cell Shared budget: $' + cellSharedBudget);
	
	//Get other shared
	var budgetSelector = AdWordsApp.budgets().withCondition("BudgetName = 'Other Shared'");
	var budgetIter = budgetSelector.get();
	try {
		var sharedBudgetObject = budgetIter.next();
	}
	catch(err){
		noError = false;
		var prev = resultCell.getValue();
		resultCell.setValue(prev + "Other Shared not found.");
		return
	}
	//Set budget
	sharedBudget += extraSpend;
	sharedBudgetObject.setAmount(sharedBudget);
	//str = (parseFloat(allocationBackup[3]) * 100) + "%"
	Logger.log('New Other Shared budget: $' + sharedBudget);
}

// One calculation logic that distributes remaining budget evenly
function calculateBudgetEvenly(costSoFar, totalBudget, daysSoFar, totalDays) {
  var daysRemaining = totalDays - daysSoFar;
  var budgetRemaining = totalBudget - costSoFar;
  if (daysRemaining <= 0) {
    return budgetRemaining;
  } else {
    return budgetRemaining / daysRemaining;
  }
}

// Return number of days between two dates, rounded up to nearest whole day.
function datediff(from, to) {
  var millisPerDay = 1000 * 60 * 60 * 24;
  var diff = Math.ceil((to - from) / millisPerDay);
  return diff;
}

// Produces a formatted string representing a given date in a given time zone.
function getDateStringInTimeZone(format, date, timeZone) {
  date = date || new Date();
  timeZone = timeZone || AdWordsApp.currentAccount().getTimeZone();
  return Utilities.formatDate(date, timeZone, format);
}

/**
 * Finds a campaign by name, whether it is a regular, video, or shopping
 * campaign, by trying all in sequence until it finds one.
 *
 * @param {string} campaignName The campaign name to find.
 * @return {Object} The campaign found, or null if none was found.
 */
function getCampaign(campaignName) {
  var selectors = [AdWordsApp.campaigns(), AdWordsApp.videoCampaigns(),
      AdWordsApp.shoppingCampaigns()];
  for(var i = 0; i < selectors.length; i++) {
    var campaignIter = selectors[i].
        withCondition('CampaignName = "' + campaignName + '"').
		withCondition("Status = ENABLED").
        get();
    if (campaignIter.hasNext()) {
      return campaignIter.next();
    }
  }
  return null;
}

function getOtherCampaigns(account){
	
}
//Checks to see there is at least 1 active campaign
function checkAccountActive() {
  var campaigns = AdWordsApp.campaigns().
		withCondition("Status = ENABLED").get()
    if (campaigns.hasNext()) {
      return true
    }
  return false;
}

function getCampaigns(campaignName) {
  var selectors = [AdWordsApp.campaigns(), AdWordsApp.videoCampaigns(),
      AdWordsApp.shoppingCampaigns()];
  for(var i = 0; i < selectors.length; i++) {
    var campaignIter = selectors[i].
        withCondition('CampaignName CONTAINS "' + campaignName + '"').
		withCondition("Status = ENABLED").
        get();
    if (campaignIter.hasNext()) {
      return campaignIter;
    }
  }
  return null;
}

/**
 * Validates the provided spreadsheet URL to make sure that it's set up
 * properly. Throws a descriptive error message if validation fails.
 *
 * @param {string} spreadsheeturl The URL of the spreadsheet to open.
 * @return {spreadsheet} The spreadsheet object itself, fetched from the URL.
 * @throws {Error} If the spreadsheet URL hasn't been set
 */
function validateAndGetSpreadsheet(spreadsheeturl) {
  if (spreadsheeturl == 'YOUR_allocationSHEET_URL') {
    throw new Error('Please specify a valid spreadsheet URL. You can find' +
        ' a link to a template in the associated guide for this script.');
  } 
  return SpreadsheetApp.openByUrl(spreadsheeturl);
}

function readSpreadSheet(){
	var spreadsheet = validateAndGetSpreadsheet(SPREADSHEET_URL);
	spreadsheet.setSpreadsheetTimeZone(AdWordsApp.currentAccount().getTimeZone());
	sheet = spreadsheet.getSheets()[0];
}

function month(n){
	if (n == 1){return "January"}
	else if (n == 2){return "February"}
	else if (n == 3){return "March"}
	else if (n == 4){return  "April"}
	else if (n == 5){return  "May"}
	else if (n == 6){return  "June"} 
	else if (n == 7){return  "July"}
	else if (n == 8){return  "August"}
	else if (n == 9){return  "September"} 
	else if (n == 10){return  "October"}
	else if (n == 11){return  "November"} 
	else if (n == 12){return  "December"}
	}
import time
import datetime
import os
import shutil
import re
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
import tkinter as tk
from functools import partial
import platform
import datetime
from PyPDF2 import PdfReader, PdfWriter
import platform
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.webdriver import WebDriver
from selenium.webdriver.common.window import WindowTypes    
from urllib.request import urlretrieve
from pyhtml2pdf import converter
from pyhtml2pdf import compressor
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from datetime import datetime, timedelta
import gspread
import requests

from tkinter import *
from tkinter import messagebox
from selenium.webdriver.common.alert import Alert


ap = []
ap_esurvey = []
ap_claim = []
ap_invoice = []

options = Options()

options.add_experimental_option("excludeSwitches", ["disable-popup-blocking","enable-automation"])
prefs = {"credentials_enable_service": False,"profile.password_manager_enabled": False}
options.add_experimental_option("prefs", prefs)

computer_name = platform.node()

service = Service(ChromeDriverManager().install())
driver = webdriver.Chrome(service=service,options=options)
driver.get('https://eclaim3.blueventuregroup.co.th/esurvey/frmLogin.aspx') # new

driver.find_element(By.ID,'txtUserName').send_keys('wisuda.d@se.co.th')
driver.find_element(By.ID,'txtPassWord').send_keys('999')


url = 'https://se.isurvey.mobi/service/srvEMCSrpt.php'
gc = gspread.service_account(filename='creds.json')
sh = gc.open('คีย์ข้อมูล').sheet1
all_google_sheet = sh.get_all_values()


apClaim = []
apInvoice = []

for i in all_google_sheet:
    apClaim.append(i[1])
    apInvoice.append(i[2])


root = Tk()
# root.geometry('250x250')

root.title('')

# ตั้งค่าให้อยู่ด้านบนเสมอ
root.attributes("-topmost", True)
# Remove icon
root.attributes('-toolwindow', 'True')

# ตั้งค่าให้หน้าต่างไม่สามารถปรับขนาดได้
root.resizable(False, False)

#-------------------------------------
frameLeft = Frame(root)
frameLeft.grid(row=0 ,column=0)

frameRight = Frame(root)
frameRight.grid(row=0,column=1)

framebLeft = Frame(root)
framebLeft.grid(row=1,column=0)

framebRight = Frame(root)
framebRight.grid(row=1,column=1)

frame = Frame(root)
frame.grid(row=2,columnspan=2)
#-------------------------------------

radioVar = IntVar()
radioVar.set(1)

statusSend = False
valueClaim = ''
valueInvoice = ''
valueInvoiceMix = ''
selection = 0

#  wisuda.d@se.co.th 999

def process():
    global valueClaim , valueInvoice ,selection ,statusSend,invoicemixsesvVar
    
    root.title('')

    try:
        Alert(driver).text
    except:

        try:
            valueClaim = driver.find_element(By.XPATH,'//*[@id="lblRef_Claim_No"]').text
            valueInvoice = driver.find_element(By.XPATH,'//*[@id="txtBill_No"]').get_attribute('value')

            sendButton.config(state='normal')
            entryClaim.config(state='normal')
            entryInvoice.config(state='normal')
            mainRadio.config(state='normal')
            conRadio.config(state='normal')
            mixRadio.config(state='normal')
            mixEntry.config(state='normal')
            sesvEntry.config(state='normal')
            sesvRadio.config(state='normal')
            selection = radioVar.get()

            if selection == 3 :
                labelInvoice.config(text='เลขเซอร์เวย์',bg='gray88')
                labelClaim.config(text='เลขเคลม',bg='gray88')

                entryInvoice.config(state='readonly')
                entryClaim.config(state='readonly')
                sesvEntry.config(state='disabled')
                mixEntry.config(state='normal')

                mainRadio.config(state='disabled')
                conRadio.config(state='disabled')
     

            elif selection == 4 :
                labelInvoice.config(text='เลขเซอร์เวย์',bg='gray88')
                labelClaim.config(text='เลขเคลม',bg='gray88')

                entryInvoice.config(state='readonly')
                entryClaim.config(state='readonly')
                sesvEntry.config(state='normal')
                mixEntry.config(state='disabled')

                mainRadio.config(state='disabled')
                conRadio.config(state='disabled')
                
            else:
                labelInvoice.config(state='normal')
                labelClaim.config(state='normal')
                mixEntry.delete(0,END)

                if valueClaim in apClaim and valueClaim != '':
                    labelClaim.config(text='มีเลขเคลมนี้แล้ว',bg='firebrick2')
                    entryClaim.config(bg='firebrick2')
                    entryClaim.delete(0,END)
                    entryClaim.insert(0,valueClaim)

                elif valueClaim not in apClaim and valueClaim != '':
                    labelClaim.config(text='เลขเคลม',bg='#00C957')
                    entryClaim.delete(0,END)
                    entryClaim.insert(0,valueClaim)
                    entryClaim.config(bg='#00C957')

                if valueInvoice in apInvoice and valueInvoice != '':
                    labelInvoice.config(text='กรอกเลข SESV',bg='firebrick2')
                    entryInvoice.config(bg='firebrick2')
                    entryInvoice.delete(0,END)
                    entryInvoice.insert(0,valueInvoice)
                    sendButton.config(state="disabled")
                    mainRadio.config(state='disabled')
                    conRadio.config(state='disabled')
                    mixEntry.config(state='disabled')
                    sesvEntry.config(state='disabled')


                elif valueInvoice not in apInvoice and valueInvoice !='':
                    labelInvoice.config(text='เลขเซอร์เวย์',bg='#00C957')
                    entryInvoice.delete(0,END)
                    entryInvoice.insert(0,valueInvoice)
                    entryInvoice.config(bg='#00C957')
                    sendButton.config(state="normal")


        except:
            valueClaim = ''
            valueInvoice = ''

            labelInvoice.config(text='เลขเซอร์เวย์',bg='gray88')
            labelClaim.config(text='เลขเคลม',bg='gray88')

            entryClaim.config(state='normal')
            entryClaim.delete(0,END)
            entryClaim.config(state='disabled')

            entryInvoice.config(state='normal')
            entryInvoice.delete(0,END)
            entryInvoice.config(state='disabled')  

            mixEntry.config(state='normal')
            mixEntry.delete(0,END)
            mixEntry.config(state='disabled')

            sesvEntry.config(state='normal')
            sesvEntry.delete(0,END)
            sesvEntry.config(state='disabled')

            sesvRadio.config(state='disabled')
            mixRadio.config(state='disabled')
            mainRadio.config(state='disabled')
            conRadio.config(state='disabled')

            sendButton.config(state='disabled')
            radioVar.set(1)
            selection = 1


    # -----------------------------------------------------------------------------------------------------------
    root.after(100,process)

def fuc_send():
    global valueClaim ,valueInvoice ,selection ,statusSend ,invoicemixsesvVar

    if selection == 3:
        select = 'งานรวม'
        invoicemixsesvVar = mixEntry.get()
    
    elif selection == 4:
        select = 'SESV'
        invoicemixsesvVar = sesvEntry.get()

    else:
        if selection == 1:
            select = 'งานต้น'
        elif selection == 2:
            select = 'งานตาม'
            
        invoicemixsesvVar = ''



    root.title('ส่งข้อมูลแล้ว')
    keyer = driver.find_element(By.XPATH,'//*[@id="wuHeadUser1_lblUser_Name"]').text
    sh.append_row([str(datetime.now()),str(valueClaim),str(valueInvoice),keyer,select,str(invoicemixsesvVar)])

    #--------------------------------------------------------------------------------------------------
    # # Isurvey
    # mydata = {
    #     "survey_no": valueInvoice,
    #     "claim_no": valueClaim,
    #     "EMCSstatus": "send",
    #     "EMCSby": keyer,
    #     "EMCSdate": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    #     "user_id": "sesurvey",
    #     "password": "pass1234"
    # }


    if selection == 3 :
        # งานรวม
        mydata = {
        "survey_no": invoicemixsesvVar,
        "claim_no": valueClaim,
        "EMCSstatus": "send",
        "EMCSby": keyer,
        "EMCSdate": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "user_id": "sesurvey",
        "password": "pass1234"
        }
    else:
        # งานต้น งานตาม 
        mydata = {
        "survey_no": valueInvoice,
        "claim_no": valueClaim,
        "EMCSstatus": "send",
        "EMCSby": keyer,
        "EMCSdate": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "user_id": "sesurvey",
        "password": "pass1234"
        }


    x = requests.post(url,json=mydata)  # เมื่อทดสอบแล้วต้องเปิดด้วย ถ้าไม่เปิดจะส่งค่าไป isurvey ไม่ได้

    apClaim.append(valueClaim)
    apInvoice.append(valueInvoice)
    time.sleep(1)

#---------------------------------------------------------------------------------------------------------
# Widget ใน Frame ซ้าย
#---------------------------------------------------------------------------------------------------------

labelClaim = Label(frameLeft , font="Arial 10 bold",justify=CENTER,text='เลขเคลม',bg='gray88')
labelClaim.grid(row=0,column=0, sticky="NSEW")

labelInvoice = Label(frameLeft , width=15,font="Arial 10 bold",justify=CENTER,text='เลขเซอร์เวย์',bg='gray88')
labelInvoice.grid(row=1,column=0, sticky="NSEW")

mainRadio = Radiobutton(frameLeft,text='งานต้น ',variable=radioVar,value=1,relief=FLAT)
mainRadio.grid(row=2,column=0, sticky="NSEW")

mixRadio = Radiobutton(framebLeft,text='งานรวม',variable=radioVar,value=3,relief=FLAT)
mixRadio.grid(row=3,column=0,sticky="NSEW")

sesvRadio = Radiobutton(framebLeft,text='SESV IV',variable=radioVar,value=4,relief=FLAT)
sesvRadio.grid(row=4,column=0,sticky="NSEW")
#---------------------------------------------------------------------------------------------------------
# Widget ใน Frame ขวา
#---------------------------------------------------------------------------------------------------------

entryClaim = Entry(frameRight,width=15,font="Arial 10 bold",justify=CENTER,relief=GROOVE ,bg='white',state='readonly')
entryClaim.grid(row=0,column=1, sticky="NSEW")

entryInvoice = Entry(frameRight,width=20,font="Arial 10 bold",justify=CENTER,relief=GROOVE ,bg='white',state='readonly')
entryInvoice.grid(row=1,column=1, sticky="NSEW")

conRadio = Radiobutton(frameRight,text='งานตาม',variable=radioVar,value=2,relief=FLAT)
conRadio.grid(row=2,column=1, sticky="NSEW")

mixEntry = Entry(framebRight,width=20,font="Arial 10 bold",justify=CENTER,relief=GROOVE ,bg='white')
mixEntry.grid(row=3,column=1,sticky="NSEW")

sesvEntry = Entry(framebRight,width=20,font="Arial 10 bold",justify=CENTER,relief=GROOVE ,bg='white')
sesvEntry.grid(row=4,column=1,sticky="NSEW")

#---------------------------------------------------------------------------------------------------------

sendButton = Button(frame,text='บันทึกข้อมูล',command=fuc_send,width=38,height=2,bg='dodgerblue1')
sendButton.grid(row=0,column=0 ,sticky="NSEW")

#---------------------------------------------------------------------------------------------------------


root.after(2000,process)
root.mainloop()
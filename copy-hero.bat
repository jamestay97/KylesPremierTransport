@echo off
set "SRC=C:\Users\james\.cursor\projects\c-Users-james-Downloads-Kyle-s-TPA-Shuttle-Website\assets\c__Users_james_AppData_Roaming_Cursor_User_workspaceStorage_84ddb285878667470f5aaa2c074c960b_images_Gemini_Generated_Image_4t8ync4t8ync4t8y-a8a24b91-c1b6-46d9-b605-64740166157b.png"
set "DEST=%~dp0images\hero-header.png"
if exist "%SRC%" (
  copy /Y "%SRC%" "%DEST%" && echo Copied hero image to images\hero-header.png
) else (
  echo Source image not found. Please add an image to the images folder and name it hero-header.png
)

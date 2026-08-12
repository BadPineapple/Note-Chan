; Trecho NSIS extra do Note-Chan, incluído pelo electron-builder através de
; build.nsis.include no package.json. Só acrescenta o atalho de desinstalação
; no Menu Iniciar -- todo o resto da instalação continua sendo o padrão do
; electron-builder.
;
; A entrada em "Aplicativos e Recursos" do Windows já é criada sozinha; este
; atalho é pra quem procura desinstalar pelo Menu Iniciar, junto do atalho do
; próprio app (ver menuCategory no package.json, que é o que garante que os
; dois fiquem na mesma pasta).

!macro customInstall
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Desinstalar ${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Desinstalar ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
!macroend
